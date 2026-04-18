import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { WikilinkForwardService } from './WikilinkForwardService';

type Frontmatter = Record<string, unknown> | undefined;

interface MockFile {
  path: string;
  basename: string;
  frontmatter?: Frontmatter;
}

interface MockEditor {
  getValue: jest.Mock<string, []>;
  setValue: jest.Mock<void, [string]>;
}

interface PluginWithFilesResult {
  plugin: jest.Mocked<StewardPlugin>;
  filesByPath: Map<string, TFile>;
  frontmatterByPath: Map<string, Frontmatter>;
  processFrontMatter: jest.Mock;
  emitMetadataChanged: (file: TFile) => void;
  setActiveEditorContent: (content: string) => void;
  clearActiveEditor: () => void;
  getActiveEditor: () => MockEditor | null;
}

function makeTFile(mock: MockFile): TFile {
  const file = new TFile();
  file.path = mock.path;
  file.basename = mock.basename;
  return file;
}

/**
 * Builds a plugin mock where `app.vault.getFileByPath` and `metadataCache.getFileCache`
 * are backed by a simple map of files. The mock also exposes a single active editor via
 * `plugin.editor` whose content can be driven from the test via
 * `setActiveEditorContent` / `clearActiveEditor`.
 */
function createPluginWithFiles(
  files: MockFile[],
  overrides: Partial<{ stewardFolder: string }> = {}
): PluginWithFilesResult {
  const filesByPath = new Map<string, TFile>();
  const frontmatterByPath = new Map<string, Frontmatter>();
  for (const mock of files) {
    filesByPath.set(mock.path, makeTFile(mock));
    frontmatterByPath.set(mock.path, mock.frontmatter);
  }

  const metadataChangedHandlers: Array<(file: TFile) => void> = [];

  const getFileByPath = jest.fn((path: string): TFile | null => filesByPath.get(path) ?? null);
  const getFileCache = jest.fn((file: TFile) => {
    const fm = frontmatterByPath.get(file.path);
    return fm ? { frontmatter: fm } : null;
  });
  const metadataCacheOn = jest.fn((event: string, handler: (file: TFile) => void) => {
    if (event === 'changed') {
      metadataChangedHandlers.push(handler);
    }
    return { event, handler };
  });
  const processFrontMatter = jest.fn(async (file: TFile, fn: (fm: Frontmatter) => void) => {
    const existing = (frontmatterByPath.get(file.path) ?? {}) as Record<string, unknown>;
    fn(existing);
    frontmatterByPath.set(file.path, existing);
  });

  let activeEditor: MockEditor | null = null;

  const plugin = {
    registerEvent: jest.fn(),
    app: {
      vault: { getFileByPath },
      metadataCache: {
        getFileCache,
        on: metadataCacheOn,
      },
      fileManager: { processFrontMatter },
    },
    settings: { stewardFolder: overrides.stewardFolder ?? 'Steward' },
    get editor() {
      return activeEditor;
    },
  } as unknown as jest.Mocked<StewardPlugin>;

  const setActiveEditorContent = (content: string): void => {
    let current = content;
    activeEditor = {
      getValue: jest.fn(() => current),
      setValue: jest.fn((next: string) => {
        current = next;
      }),
    };
  };
  const clearActiveEditor = (): void => {
    activeEditor = null;
  };
  const getActiveEditor = (): MockEditor | null => activeEditor;

  const emitMetadataChanged = (file: TFile): void => {
    for (const handler of metadataChangedHandlers) {
      handler(file);
    }
  };

  return {
    plugin,
    filesByPath,
    frontmatterByPath,
    processFrontMatter,
    emitMetadataChanged,
    setActiveEditorContent,
    clearActiveEditor,
    getActiveEditor,
  };
}

describe('WikilinkForwardService', () => {
  describe('getConversationEmbedPath', () => {
    it('strips .md and joins with the Steward/Conversations folder', () => {
      const { plugin } = createPluginWithFiles([]);
      const service = new WikilinkForwardService(plugin);
      expect(service.getConversationEmbedPath('My Title')).toBe('Steward/Conversations/My Title');
      expect(service.getConversationEmbedPath('My Title.md')).toBe(
        'Steward/Conversations/My Title'
      );
    });

    it('respects a custom stewardFolder setting', () => {
      const { plugin } = createPluginWithFiles([], { stewardFolder: 'Notes/Steward' });
      const service = new WikilinkForwardService(plugin);
      expect(service.getConversationEmbedPath('Chat')).toBe('Notes/Steward/Conversations/Chat');
    });
  });

  describe('getConversationFile', () => {
    it('returns the file when looking up by title under Conversations', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/NoteA.md', basename: 'NoteA' },
      ]);
      const service = new WikilinkForwardService(plugin);
      const file = service.getConversationFile('NoteA');
      expect(file?.path).toBe('Steward/Conversations/NoteA.md');
    });

    it('returns null when the title resolves to a file outside Conversations', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'OtherFolder/NoteA.md', basename: 'NoteA' },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.getConversationFile('OtherFolder/NoteA')).toBeNull();
    });

    it('returns null for empty or whitespace titles', () => {
      const { plugin } = createPluginWithFiles([]);
      const service = new WikilinkForwardService(plugin);
      expect(service.getConversationFile('')).toBeNull();
      expect(service.getConversationFile('   ')).toBeNull();
    });
  });

  describe('resolveForwardedConversationTitle', () => {
    it('returns null when the source file has no forwarding frontmatter', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A' },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedConversationTitle('A')).toBeNull();
    });

    it('resolves `forwarded_to` as a bare title', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: { forwarded_to: 'B' } },
        { path: 'Steward/Conversations/B.md', basename: 'B' },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedConversationTitle('A')).toBe('B');
    });

    it('trims surrounding whitespace from the title', () => {
      const { plugin } = createPluginWithFiles([
        {
          path: 'Steward/Conversations/A.md',
          basename: 'A',
          frontmatter: { forwarded_to: '  B  ' },
        },
        { path: 'Steward/Conversations/B.md', basename: 'B' },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedConversationTitle('A')).toBe('B');
    });

    it('prefers `continued_to` over `forwarded_to`', () => {
      const { plugin } = createPluginWithFiles([
        {
          path: 'Steward/Conversations/A.md',
          basename: 'A',
          frontmatter: { forwarded_to: 'B', continued_to: 'C' },
        },
        { path: 'Steward/Conversations/B.md', basename: 'B' },
        { path: 'Steward/Conversations/C.md', basename: 'C' },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedConversationTitle('A')).toBe('C');
    });

    it('returns null when the forwarding value is non-string', () => {
      const { plugin } = createPluginWithFiles([
        {
          path: 'Steward/Conversations/A.md',
          basename: 'A',
          frontmatter: { forwarded_to: 123 },
        },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedConversationTitle('A')).toBeNull();
    });

    it('returns null when the source file is missing', () => {
      const { plugin } = createPluginWithFiles([]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedConversationTitle('Missing')).toBeNull();
    });
  });

  describe('resolveForwardedChainTerminalTitle', () => {
    it('returns the start title when there is no forward', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedChainTerminalTitle('A')).toBe('A');
    });

    it('follows a single hop A → B', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: { forwarded_to: 'B' } },
        { path: 'Steward/Conversations/B.md', basename: 'B', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedChainTerminalTitle('A')).toBe('B');
    });

    it('follows multiple hops A → B → C', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: { forwarded_to: 'B' } },
        { path: 'Steward/Conversations/B.md', basename: 'B', frontmatter: { forwarded_to: 'C' } },
        { path: 'Steward/Conversations/C.md', basename: 'C', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedChainTerminalTitle('A')).toBe('C');
    });

    it('returns empty string for a blank start title', () => {
      const { plugin } = createPluginWithFiles([]);
      const service = new WikilinkForwardService(plugin);
      expect(service.resolveForwardedChainTerminalTitle('   ')).toBe('');
    });
  });

  describe('shouldAppendInputLineForConversation', () => {
    it('returns true for a regular conversation without exceptions', () => {
      const { plugin } = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.shouldAppendInputLineForConversation('A')).toBe(true);
    });

    it('returns true when the file is missing (default)', () => {
      const { plugin } = createPluginWithFiles([]);
      const service = new WikilinkForwardService(plugin);
      expect(service.shouldAppendInputLineForConversation('Missing')).toBe(true);
    });

    it('returns false when the basename starts with cli_interactive', () => {
      const { plugin } = createPluginWithFiles([
        {
          path: 'Steward/Conversations/cli_interactive_foo.md',
          basename: 'cli_interactive_foo',
        },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.shouldAppendInputLineForConversation('cli_interactive_foo')).toBe(false);
    });

    it('returns false when frontmatter declares a `trigger` key (any value)', () => {
      const { plugin } = createPluginWithFiles([
        {
          path: 'Steward/Conversations/Scripted.md',
          basename: 'Scripted',
          frontmatter: { trigger: 'on-open' },
        },
        {
          path: 'Steward/Conversations/ScriptedEmpty.md',
          basename: 'ScriptedEmpty',
          frontmatter: { trigger: '' },
        },
      ]);
      const service = new WikilinkForwardService(plugin);
      expect(service.shouldAppendInputLineForConversation('Scripted')).toBe(false);
      expect(service.shouldAppendInputLineForConversation('ScriptedEmpty')).toBe(false);
    });
  });

  describe('setForwardedTo', () => {
    it('writes `forwarded_to` as a plain title on the source note', async () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(ctx.plugin);
      await service.setForwardedTo({
        sourceConversationTitle: 'A',
        targetConversationTitle: 'B',
      });
      expect(ctx.processFrontMatter).toHaveBeenCalledTimes(1);
      expect(ctx.frontmatterByPath.get('Steward/Conversations/A.md')).toEqual({
        forwarded_to: 'B',
      });
    });

    it('writes the `continued_to` key when requested', async () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(ctx.plugin);
      await service.setForwardedTo({
        sourceConversationTitle: 'A',
        targetConversationTitle: 'B',
        key: 'continued_to',
      });
      expect(ctx.frontmatterByPath.get('Steward/Conversations/A.md')).toEqual({
        continued_to: 'B',
      });
    });

    it('no-ops when the source note is missing', async () => {
      const ctx = createPluginWithFiles([]);
      const service = new WikilinkForwardService(ctx.plugin);
      await service.setForwardedTo({
        sourceConversationTitle: 'Missing',
        targetConversationTitle: 'B',
      });
      expect(ctx.processFrontMatter).not.toHaveBeenCalled();
    });
  });

  describe('setForwardedTo auto-clears target', () => {
    it('clears both forward keys on the target note when the source is set to point at it', async () => {
      const ctx = createPluginWithFiles([
        {
          path: 'Steward/Conversations/Source.md',
          basename: 'Source',
          frontmatter: {},
        },
        {
          path: 'Steward/Conversations/Target.md',
          basename: 'Target',
          frontmatter: { forwarded_to: 'Old', continued_to: 'Other', keep: 'yes' },
        },
      ]);
      const service = new WikilinkForwardService(ctx.plugin);
      await service.setForwardedTo({
        sourceConversationTitle: 'Source',
        targetConversationTitle: 'Target',
      });
      expect(ctx.frontmatterByPath.get('Steward/Conversations/Source.md')).toEqual({
        forwarded_to: 'Target',
      });
      expect(ctx.frontmatterByPath.get('Steward/Conversations/Target.md')).toEqual({
        keep: 'yes',
      });
    });

    it('does not attempt to clear when the target note is missing', async () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/Source.md', basename: 'Source', frontmatter: {} },
      ]);
      const service = new WikilinkForwardService(ctx.plugin);
      await service.setForwardedTo({
        sourceConversationTitle: 'Source',
        targetConversationTitle: 'MissingTarget',
      });
      expect(ctx.processFrontMatter).toHaveBeenCalledTimes(1);
      expect(ctx.frontmatterByPath.get('Steward/Conversations/Source.md')).toEqual({
        forwarded_to: 'MissingTarget',
      });
    });

    it('does not clear when source and target resolve to the same file', async () => {
      const ctx = createPluginWithFiles([
        {
          path: 'Steward/Conversations/Self.md',
          basename: 'Self',
          frontmatter: { forwarded_to: 'prev' },
        },
      ]);
      const service = new WikilinkForwardService(ctx.plugin);
      await service.setForwardedTo({
        sourceConversationTitle: 'Self',
        targetConversationTitle: 'Self',
      });
      expect(ctx.processFrontMatter).toHaveBeenCalledTimes(1);
      expect(ctx.frontmatterByPath.get('Steward/Conversations/Self.md')).toEqual({
        forwarded_to: 'Self',
      });
    });
  });

  describe('event-driven embed rewriting in active editor', () => {
    it('rewrites `![[source]]` to `![[target]]` in the active editor when the source gains a forward target', () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A' },
        { path: 'Steward/Conversations/B.md', basename: 'B' },
      ]);
      ctx.setActiveEditorContent(`intro\n![[Steward/Conversations/A]]\n\n/ tail`);

      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      ctx.frontmatterByPath.set('Steward/Conversations/A.md', { forwarded_to: 'B' });
      ctx.emitMetadataChanged(ctx.filesByPath.get('Steward/Conversations/A.md')!);

      const editor = ctx.getActiveEditor()!;
      expect(editor.setValue).toHaveBeenCalledWith(`intro\n![[Steward/Conversations/B]]\n\n/ tail`);
    });

    it('does not touch the editor when the source has no forward target', () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A', frontmatter: {} },
      ]);
      ctx.setActiveEditorContent(`![[Steward/Conversations/A]]`);

      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      ctx.emitMetadataChanged(ctx.filesByPath.get('Steward/Conversations/A.md')!);

      const editor = ctx.getActiveEditor()!;
      expect(editor.setValue).not.toHaveBeenCalled();
    });

    it('only rewrites once when the same forward target is re-emitted', () => {
      const ctx = createPluginWithFiles([
        {
          path: 'Steward/Conversations/A.md',
          basename: 'A',
          frontmatter: { forwarded_to: 'B' },
        },
        { path: 'Steward/Conversations/B.md', basename: 'B' },
      ]);
      ctx.setActiveEditorContent(`![[Steward/Conversations/A]]`);

      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      const sourceFile = ctx.filesByPath.get('Steward/Conversations/A.md')!;
      ctx.emitMetadataChanged(sourceFile);
      ctx.emitMetadataChanged(sourceFile);

      const editor = ctx.getActiveEditor()!;
      expect(editor.setValue).toHaveBeenCalledTimes(1);
    });

    it('ignores metadata changes for files outside Steward/Conversations', () => {
      const ctx = createPluginWithFiles([
        {
          path: 'Other/Folder/A.md',
          basename: 'A',
          frontmatter: { forwarded_to: 'B' },
        },
      ]);
      ctx.setActiveEditorContent(`![[Other/Folder/A]]`);
      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      ctx.emitMetadataChanged(ctx.filesByPath.get('Other/Folder/A.md')!);

      const editor = ctx.getActiveEditor()!;
      expect(editor.setValue).not.toHaveBeenCalled();
    });

    it('no-ops silently when there is no active editor', () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A' },
        { path: 'Steward/Conversations/B.md', basename: 'B' },
      ]);
      ctx.clearActiveEditor();
      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      ctx.frontmatterByPath.set('Steward/Conversations/A.md', { forwarded_to: 'B' });
      expect(() => {
        ctx.emitMetadataChanged(ctx.filesByPath.get('Steward/Conversations/A.md')!);
      }).not.toThrow();
    });

    it('omits the `/ ` input line when the target is cli_interactive*', () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A' },
        {
          path: 'Steward/Conversations/cli_interactive_shell.md',
          basename: 'cli_interactive_shell',
        },
      ]);
      ctx.setActiveEditorContent(`start\n![[Steward/Conversations/A]]\nend`);

      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      ctx.frontmatterByPath.set('Steward/Conversations/A.md', {
        forwarded_to: 'cli_interactive_shell',
      });
      ctx.emitMetadataChanged(ctx.filesByPath.get('Steward/Conversations/A.md')!);

      const editor = ctx.getActiveEditor()!;
      expect(editor.setValue).toHaveBeenCalledWith(
        `start\n![[Steward/Conversations/cli_interactive_shell]]\nend`
      );
    });

    it('strips a trailing `/ ` input line plus two-space continuation lines when target is cli_interactive*', () => {
      const ctx = createPluginWithFiles([
        { path: 'Steward/Conversations/A.md', basename: 'A' },
        {
          path: 'Steward/Conversations/cli_interactive_shell.md',
          basename: 'cli_interactive_shell',
        },
      ]);
      const before = [
        'intro',
        '![[Steward/Conversations/A]]',
        '',
        '/ run command',
        '  with continuation',
        '  more continuation',
        'after',
      ].join('\n');
      ctx.setActiveEditorContent(before);

      const service = new WikilinkForwardService(ctx.plugin);
      service.registerEvents();

      ctx.frontmatterByPath.set('Steward/Conversations/A.md', {
        forwarded_to: 'cli_interactive_shell',
      });
      ctx.emitMetadataChanged(ctx.filesByPath.get('Steward/Conversations/A.md')!);

      const editor = ctx.getActiveEditor()!;
      expect(editor.setValue).toHaveBeenCalledWith(
        ['intro', '![[Steward/Conversations/cli_interactive_shell]]', 'after'].join('\n')
      );
    });
  });
});
