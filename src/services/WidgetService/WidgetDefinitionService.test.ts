import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import { WidgetDefinitionService } from './WidgetDefinitionService';

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

function buildValidWidgetMd(): string {
  return [
    '```yaml',
    'name: manifest',
    'entry: index.html',
    'type: html',
    '```',
    '',
    '```yaml',
    'name: actions',
    'actions:',
    '  playCell:',
    '    params:',
    '      index:',
    '        type: integer',
    '        minimum: 0',
    '        maximum: 8',
    '```',
    '',
    '```yaml',
    'name: actors',
    'mode: user_and_models',
    'turnOrder:',
    '  - user',
    '  - o',
    'actors:',
    '  user:',
    '    kind: human',
    '  o:',
    '    kind: model',
    '```',
    '',
    '```yaml',
    'name: agent',
    'id: o',
    'instructions:',
    '  - Play O in tic-tac-toe.',
    'actions:',
    '  - playCell',
    '```',
  ].join('\n');
}

function createValidatorPlugin(content: string): jest.Mocked<StewardPlugin> {
  const plugin = {
    settings: { stewardFolder: 'Steward' },
    app: {
      metadataCache: {
        getFileCache: jest.fn().mockImplementation(() => ({
          sections: buildMarkdownSections(content),
          frontmatter: {},
        })),
      },
      vault: {
        read: jest.fn().mockResolvedValue(content),
        getFileByPath: jest.fn(),
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

function bindPrivateMethods(service: WidgetDefinitionService) {
  return {
    validateContent: service['validateContent'].bind(
      service
    ) as WidgetDefinitionService['validateContent'],
    validateAndUpdateFrontmatter: service['validateAndUpdateFrontmatter'].bind(
      service
    ) as WidgetDefinitionService['validateAndUpdateFrontmatter'],
  };
}

describe('WidgetDefinitionService', () => {
  const file = { path: 'Steward/Widgets/Tic-Tac-Toe-abc/Widget.md' } as TFile;

  beforeEach(() => {
    (WidgetDefinitionService as unknown as { instance: WidgetDefinitionService | null }).instance =
      null;
  });

  it('accepts a complete valid Widget.md definition', () => {
    const content = buildValidWidgetMd();
    const plugin = createValidatorPlugin(content);
    const { validateContent } = bindPrivateMethods(WidgetDefinitionService.getInstance(plugin));
    const result = validateContent({ content, file });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('requires a manifest block', () => {
    const content = '```yaml\nname: actions\nactions: {}\n```';
    const plugin = createValidatorPlugin(content);
    const { validateContent } = bindPrivateMethods(WidgetDefinitionService.getInstance(plugin));
    const result = validateContent({ content, file });
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('manifest'))).toBe(true);
  });

  it('requires actors and actions when agent blocks exist', () => {
    const content = [
      '```yaml',
      'name: manifest',
      'entry: index.html',
      'type: html',
      '```',
      '',
      '```yaml',
      'name: agent',
      'id: o',
      'instructions:',
      '  - Play.',
      'actions:',
      '  - playCell',
      '```',
    ].join('\n');
    const plugin = createValidatorPlugin(content);
    const { validateContent } = bindPrivateMethods(WidgetDefinitionService.getInstance(plugin));
    const result = validateContent({ content, file });
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('actors: required'))).toBe(true);
    expect(result.errors.some(error => error.includes('actions: required'))).toBe(true);
  });

  it('updates frontmatter status on validateAndUpdateFrontmatter', async () => {
    const content = buildValidWidgetMd();
    const plugin = createValidatorPlugin(content);
    const processFrontMatter = jest.fn(async (_file, mutator) => {
      const fm: Record<string, unknown> = {};
      mutator(fm);
      expect(fm.enabled).toBe(true);
      expect(typeof fm.status).toBe('string');
    });
    plugin.app.fileManager.processFrontMatter = processFrontMatter;

    const { validateAndUpdateFrontmatter } = bindPrivateMethods(
      WidgetDefinitionService.getInstance(plugin)
    );
    const result = await validateAndUpdateFrontmatter(file);

    expect(result.valid).toBe(true);
    expect(processFrontMatter).toHaveBeenCalled();
  });

  it('getWidgetDefinition reads all blocks in a single vault read', async () => {
    const content = buildValidWidgetMd();
    const plugin = createValidatorPlugin(content);
    const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc';
    plugin.app.vault.getFileByPath = jest.fn().mockReturnValue(file);

    const service = WidgetDefinitionService.getInstance(plugin);
    const definition = await service.getWidgetDefinition(projectPath);

    expect(plugin.app.vault.read).toHaveBeenCalledTimes(1);
    expect(definition.manifest?.entry).toBe('index.html');
    expect(definition.actions?.actions.playCell).toBeDefined();
    expect(definition.actors?.turnOrder).toEqual(['user', 'o']);
    expect(definition.agents.o?.id).toBe('o');
  });

  it('rejects agent queries missing from the queries catalog', () => {
    const content = [
      '```yaml',
      'name: manifest',
      'entry: index.html',
      'type: html',
      '```',
      '',
      '```yaml',
      'name: actions',
      'actions:',
      '  playCell: {}',
      '```',
      '',
      '```yaml',
      'name: actors',
      'mode: user_and_models',
      'turnOrder:',
      '  - user',
      '  - o',
      'actors:',
      '  user:',
      '    kind: human',
      '  o:',
      '    kind: model',
      '```',
      '',
      '```yaml',
      'name: agent',
      'id: o',
      'instructions:',
      '  - Play.',
      'actions:',
      '  - playCell',
      'queries:',
      '  - getLegalMoves',
      '```',
    ].join('\n');
    const plugin = createValidatorPlugin(content);
    const { validateContent } = bindPrivateMethods(WidgetDefinitionService.getInstance(plugin));
    const result = validateContent({ content, file });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(error =>
        error.includes('queries block is required when agent lists queries')
      )
    ).toBe(true);
  });

  it('readEditedDefinitionStatusFromFrontmatter returns invalid status only', () => {
    const content = buildValidWidgetMd();
    const plugin = createValidatorPlugin(content);
    plugin.app.metadataCache.getFileCache = jest.fn().mockImplementation((f: TFile) => {
      if (f.path.endsWith('Widget.md')) {
        return {
          sections: buildMarkdownSections(content),
          frontmatter: { status: 'Invalid: bad agent' },
        };
      }
      return null;
    });
    plugin.app.vault.getFileByPath = jest.fn().mockReturnValue(file);

    const service = WidgetDefinitionService.getInstance(plugin);
    const message = service.readEditedDefinitionStatusFromFrontmatter([file.path]);

    expect(message).toContain('Invalid: bad agent');
  });
});
