import { ShellOutputArchiveService } from './ShellOutputArchiveService';
import type StewardPlugin from 'src/main';

function createMockPlugin(): jest.Mocked<StewardPlugin> & {
  __files__: Map<string, { content: string }>;
} {
  const files = new Map<string, { content: string }>();
  const vaultGetFileByPath = jest.fn((path: string) => {
    if (files.has(path)) {
      return { path };
    }
    return null;
  });
  const vaultCachedRead = jest.fn(async (file: { path: string }) => {
    const entry = files.get(file.path);
    return entry?.content ?? '';
  });
  const vaultProcess = jest.fn(async (file: { path: string }, fn: (c: string) => string) => {
    const entry = files.get(file.path);
    if (!entry) throw new Error(`File not found: ${file.path}`);
    entry.content = fn(entry.content);
  });
  const vaultCreate = jest.fn(async (path: string, content: string) => {
    files.set(path, { content });
    return { path };
  });
  const vaultCreateFolder = jest.fn(async (_path: string) => {});
  const vaultAdapterExists = jest.fn(async (_path: string) => true);

  const extractContentUnderHeading = jest.fn(async (filePath: string, headingText: string) => {
    const entry = files.get(filePath);
    if (!entry) return '';
    const lines = entry.content.split('\n');
    const headingLine = lines.findIndex(
      l => l.startsWith('## ') && l.slice(3).trim() === headingText
    );
    if (headingLine === -1) return '';
    const result: string[] = [];
    for (let i = headingLine + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) break;
      result.push(lines[i]);
    }
    return result.join('\n').trim();
  });

  const getConversationFileByName = jest.fn((name: string) => {
    const path = `Steward/Conversations/${name.replace(/\.md$/, '')}.md`;
    if (!files.has(path)) {
      throw new Error(`Note not found: ${path}`);
    }
    return { path };
  });

  const replaceMessageContent = jest.fn(
    async (_conversationTitle: string, _messageId: string, _newBody: string) => {
      const title = _conversationTitle;
      const filePath = `Steward/Conversations/${title}.md`;
      const entry = files.get(filePath);
      if (!entry) return;
      const idPattern = `ID:${_messageId}`;
      const commentRegex = new RegExp(`(<!--STW ${idPattern}[^>]*-->)`, 'gi');
      const commentMatch = commentRegex.exec(entry.content);
      if (!commentMatch) return;
      const commentEnd = (commentMatch.index ?? 0) + commentMatch[0].length;
      const nextCommentRegex = /<!--STW ID:[^>]*-->/gi;
      nextCommentRegex.lastIndex = commentEnd;
      const nextMatch = nextCommentRegex.exec(entry.content);
      const msgEnd = nextMatch ? (nextMatch.index ?? entry.content.length) : entry.content.length;
      entry.content =
        entry.content.substring(0, commentEnd) + '\n' + _newBody + entry.content.substring(msgEnd);
    }
  );

  const result = {
    settings: { stewardFolder: 'Steward' } as unknown as StewardPlugin['settings'],
    app: {
      vault: {
        getFileByPath: vaultGetFileByPath,
        cachedRead: vaultCachedRead,
        process: vaultProcess,
        create: vaultCreate,
        createFolder: vaultCreateFolder,
        adapter: { exists: vaultAdapterExists },
      },
    } as unknown as StewardPlugin['app'],
    conversationRenderer: {
      getConversationFileByName,
      replaceMessageContent,
      getMessageById: jest.fn(),
    } as unknown as StewardPlugin['conversationRenderer'],
    noteContentService: {
      extractContentUnderHeading,
    } as unknown as StewardPlugin['noteContentService'],
    __files__: files,
  } as unknown as jest.Mocked<StewardPlugin> & { __files__: Map<string, { content: string }> };

  return result;
}

describe('ShellOutputArchiveService', () => {
  let service: ShellOutputArchiveService;
  let plugin: jest.Mocked<StewardPlugin> & { __files__: Map<string, { content: string }> };

  beforeEach(() => {
    plugin = createMockPlugin();
    service = new ShellOutputArchiveService(plugin);
  });

  describe('getShellOutputFilePath', () => {
    it('returns path with __shell suffix under Conversations folder', () => {
      expect(service.getShellOutputFilePath('My Conversation')).toBe(
        'Steward/Conversations/My Conversation__shell.md'
      );
    });

    it('sanitizes invalid characters from the title', () => {
      expect(service.getShellOutputFilePath('Test<>:Conv')).toBe(
        'Steward/Conversations/TestConv__shell.md'
      );
    });
  });

  describe('appendSection', () => {
    it('creates the shell file with frontmatter on first write', async () => {
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      await service.appendSection({
        conversationTitle: 'Test Conv',
        messageId: 'msg1',
        outputText: 'hello world',
      });

      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        'Steward/Conversations/Test Conv__shell.md',
        expect.stringContaining('## msg1')
      );
      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        'Steward/Conversations/Test Conv__shell.md',
        expect.stringContaining('conversation_title: Test Conv')
      );
    });

    it('appends a section to an existing shell file', async () => {
      const shellPath = 'Steward/Conversations/Test Conv__shell.md';
      plugin.__files__.set(shellPath, {
        content: '---\nconversation_title: Test Conv\n---\n\n## msg1\n\nfirst\n',
      });
      const existingFile = { path: shellPath };
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(existingFile);

      await service.appendSection({
        conversationTitle: 'Test Conv',
        messageId: 'msg2',
        outputText: 'more output',
      });

      expect(plugin.app.vault.process).toHaveBeenCalledWith(existingFile, expect.any(Function));
    });
  });

  describe('archiveMessageOutput', () => {
    it('extracts cli-model fence and replaces with callout-only stub', async () => {
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg1',
        role: 'assistant',
        content: '```cli-model\nline1\nline2\nline3\n```',
        history: true,
      });
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      const result = await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg1',
      });

      expect(result).not.toBeNull();
      expect(result!.path).toBe('Steward/Conversations/test-conv__shell.md');
      expect(result!.headingText).toBe('msg1');
      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        'Steward/Conversations/test-conv__shell.md',
        expect.stringContaining('```cli-model\nline1\nline2\nline3\n```')
      );
      const stub = (plugin.conversationRenderer.replaceMessageContent as jest.Mock).mock
        .calls[0][2] as string;
      expect(stub).toContain('output_file:');
      expect(stub).toContain('output_anchor:msg1');
      expect(stub).toContain('lines:3');
      expect(stub).toContain('stw-toggle-block');
      expect(stub).not.toContain('[[Steward/Conversations/test-conv__shell#msg1|');
    });

    it('emits wikilink stub without toggle anchor when output exceeds inline threshold', async () => {
      const largeBody = Array.from({ length: 1501 }, (_, i) => `line ${i + 1}`).join('\n');
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg-large',
        role: 'assistant',
        content: `\`\`\`cli-model\n${largeBody}\n\`\`\``,
        history: true,
      });
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg-large',
      });

      const stub = (plugin.conversationRenderer.replaceMessageContent as jest.Mock).mock
        .calls[0][2] as string;
      expect(stub).toContain(
        'output_file:Steward/Conversations/test-conv__shell.md,output_anchor:msg-large,lines:1501'
      );
      expect(stub).toContain('[[Steward/Conversations/test-conv__shell#msg-large|');
      expect(stub).not.toContain('stw-toggle-block');
    });

    it('emits toggle anchor stub at inline threshold', async () => {
      const body = Array.from({ length: 1500 }, (_, i) => `line ${i + 1}`).join('\n');
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg-threshold',
        role: 'assistant',
        content: `\`\`\`cli-model\n${body}\n\`\`\``,
        history: true,
      });
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg-threshold',
      });

      const stub = (plugin.conversationRenderer.replaceMessageContent as jest.Mock).mock
        .calls[0][2] as string;
      expect(stub).toContain('lines:1500');
      expect(stub).toContain('stw-toggle-block');
      expect(stub).not.toContain('[[Steward/Conversations/test-conv__shell#msg-threshold|');
    });

    it('extracts cli-model fence when message has a leading intro block', async () => {
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg1b',
        role: 'assistant',
        content:
          '<small>*Shell output is archived separately.*</small>\n\n```cli-model\nline1\nline2\n```',
        history: true,
      });
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg1b',
      });

      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        'Steward/Conversations/test-conv__shell.md',
        expect.stringContaining('```cli-model\nline1\nline2\n```')
      );
    });

    it('preserves markdown headings inside archived fence output', async () => {
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg-headings',
        role: 'assistant',
        content: '```cli-model\n## Section title\n# Top level\nbody\n```',
        history: true,
      });
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      const shellPath = 'Steward/Conversations/test-conv__shell.md';
      (plugin.app.vault.getFileByPath as jest.Mock).mockImplementation((path: string) => {
        if (plugin.__files__.has(path)) {
          return { path };
        }
        return null;
      });
      (plugin.noteContentService.extractContentUnderHeading as jest.Mock).mockResolvedValue(
        '```cli-model\n## Section title\n# Top level\nbody\n```'
      );

      await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg-headings',
      });

      const shellContent = plugin.__files__.get(shellPath)?.content;
      expect(shellContent).toContain('```cli-model\n## Section title\n# Top level\nbody\n```');

      const readBack = await service.readSection(shellPath, 'msg-headings');

      expect(readBack).toBe('## Section title\n# Top level\nbody');
      expect(plugin.noteContentService.extractContentUnderHeading).toHaveBeenCalledWith(
        shellPath,
        'msg-headings'
      );
    });

    it('extracts cli-transcript fence', async () => {
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg2',
        role: 'assistant',
        content: '```cli-transcript\noutput line\n```',
        history: true,
      });
      (plugin.app.vault.getFileByPath as jest.Mock).mockReturnValue(null);
      (plugin.app.vault.adapter.exists as jest.Mock).mockResolvedValue(true);

      const result = await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg2',
      });

      expect(result).not.toBeNull();
      expect(result!.headingText).toBe('msg2');
    });

    it('returns null when no fence is found', async () => {
      (plugin.conversationRenderer.getMessageById as jest.Mock).mockResolvedValue({
        id: 'msg3',
        role: 'assistant',
        content: 'some text without fences',
        history: true,
      });

      const result = await service.archiveMessageOutput({
        conversationTitle: 'test-conv',
        messageId: 'msg3',
      });

      expect(result).toBeNull();
    });
  });

  describe('readSection', () => {
    it('reads fenced content under a heading', async () => {
      (plugin.noteContentService.extractContentUnderHeading as jest.Mock).mockResolvedValue(
        '```cli-model\nhello output\n```'
      );

      const result = await service.readSection('Steward/Conversations/test-conv__shell.md', 'msg1');

      expect(result).toBe('hello output');
      expect(plugin.noteContentService.extractContentUnderHeading).toHaveBeenCalledWith(
        'Steward/Conversations/test-conv__shell.md',
        'msg1'
      );
    });

    it('returns bare legacy section content', async () => {
      (plugin.noteContentService.extractContentUnderHeading as jest.Mock).mockResolvedValue(
        'hello output'
      );

      const result = await service.readSection('Steward/Conversations/test-conv__shell.md', 'msg1');

      expect(result).toBe('hello output');
      expect(plugin.noteContentService.extractContentUnderHeading).toHaveBeenCalledWith(
        'Steward/Conversations/test-conv__shell.md',
        'msg1'
      );
    });

    it('returns empty string when section is empty', async () => {
      (plugin.noteContentService.extractContentUnderHeading as jest.Mock).mockResolvedValue('');

      const result = await service.readSection(
        'Steward/Conversations/nonexistent__shell.md',
        'msg1'
      );

      expect(result).toBe('');
    });
  });
});
