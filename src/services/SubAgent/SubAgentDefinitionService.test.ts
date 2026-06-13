import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import { SubAgentDefinitionService } from './SubAgentDefinitionService';
import { ToolName } from 'src/solutions/commands/toolNames';

function buildMarkdownSections(content: string) {
  const lines = content.split('\n');
  const sections: Array<{
    type: string;
    position: {
      start: { line: number; col: number; offset: number };
      end: { line: number; col: number; offset: number };
    };
  }> = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (line.match(/^```/)) {
      let endLine = lineIndex;
      for (let i = lineIndex + 1; i < lines.length; i++) {
        if (lines[i].match(/^```/)) {
          endLine = i;
          break;
        }
      }
      sections.push({
        type: 'code',
        position: {
          start: { line: lineIndex, col: 0, offset: 0 },
          end: { line: endLine, col: lines[endLine].length, offset: 0 },
        },
      });
      lineIndex = endLine + 1;
      continue;
    }

    lineIndex++;
  }

  return sections;
}

function buildValidSubAgentsMd(): string {
  return [
    '## Image vision',
    '',
    '```yaml',
    'name: agent',
    'id: image_vision',
    'description: Reads and analyzes images using a vision-capable model',
    'model: google:gemini-2.5-flash',
    'instruction: |',
    '  You are an image analysis sub-agent.',
    'tools:',
    `  - ${ToolName.CONTENT_READING}`,
    '```',
  ].join('\n');
}

function createValidatorPlugin(content: string): jest.Mocked<StewardPlugin> {
  const plugin = {
    settings: { stewardFolder: 'Steward' },
    noteContentService: {
      parseMarkdownFrontmatter: jest.fn().mockReturnValue({
        frontmatter: { version: 1 },
        body: content,
      }),
    },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
    },
    app: {
      metadataCache: {
        getFileCache: jest.fn().mockImplementation(() => ({
          sections: buildMarkdownSections(content),
          frontmatter: { version: 1 },
        })),
      },
      vault: {
        read: jest.fn().mockResolvedValue(content),
        cachedRead: jest.fn().mockResolvedValue(content),
        getFileByPath: jest.fn(),
        create: jest.fn(),
        modify: jest.fn(),
      },
      fileManager: {
        processFrontMatter: jest.fn(),
      },
      workspace: {
        onLayoutReady: jest.fn((cb: () => void) => cb()),
      },
    },
    registerEvent: jest.fn(),
  } as unknown as jest.Mocked<StewardPlugin>;

  (MarkdownDefinitionService as unknown as { instance?: MarkdownDefinitionService }).instance =
    undefined;
  return {
    ...plugin,
    markdownDefinitionService: MarkdownDefinitionService.getInstance(plugin),
  } as jest.Mocked<StewardPlugin>;
}

describe('SubAgentDefinitionService', () => {
  const file = { path: 'Steward/Sub Agents.md' } as TFile;

  beforeEach(() => {
    (
      SubAgentDefinitionService as unknown as { instance: SubAgentDefinitionService | null }
    ).instance = null;
  });

  it('validates a correct agent block and exposes catalog entries', async () => {
    const content = buildValidSubAgentsMd();
    const plugin = createValidatorPlugin(content);
    const service = SubAgentDefinitionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(true);
    expect(validation.definitionsById.get('image_vision')).toMatchObject({
      id: 'image_vision',
      description: 'Reads and analyzes images using a vision-capable model',
      model: 'google:gemini-2.5-flash',
      enabled: true,
      tools: [ToolName.CONTENT_READING],
    });

    await service.validateAndUpdateFrontmatter(file);
    expect(service.getCatalog()).toEqual([
      {
        id: 'image_vision',
        description: 'Reads and analyzes images using a vision-capable model',
      },
    ]);
  });

  it('rejects duplicate agent ids', () => {
    const content = [
      '```yaml',
      'name: agent',
      'id: image_vision',
      'description: First',
      'instruction: First agent',
      '```',
      '',
      '```yaml',
      'name: agent',
      'id: image_vision',
      'description: Second',
      'instruction: Second agent',
      '```',
    ].join('\n');
    const plugin = createValidatorPlugin(content);
    const service = SubAgentDefinitionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(error => error.includes('duplicate id'))).toBe(true);
  });

  it('skips agents with enabled false from the catalog', () => {
    const content = [
      '```yaml',
      'name: agent',
      'id: disabled_agent',
      'description: Disabled agent',
      'instruction: Disabled',
      'enabled: false',
      '```',
    ].join('\n');
    const plugin = createValidatorPlugin(content);
    const service = SubAgentDefinitionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(true);
    expect(service.getCatalog()).toEqual([]);
    expect(service.getDefinition('disabled_agent')).toBeNull();
  });

  it('rejects unsupported yaml block names', () => {
    const content = ['```yaml', 'name: manifest', 'entry: index.html', 'type: html', '```'].join(
      '\n'
    );
    const plugin = createValidatorPlugin(content);
    const service = SubAgentDefinitionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(error => error.includes('unsupported block name'))).toBe(true);
  });
});
