import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import { ToolInstructionService } from './ToolInstructionService';
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

function buildValidToolInstructionsMd(): string {
  return [
    '```yaml',
    'name: tool_instruction',
    `tool: ${ToolName.SHELL}`,
    'enabled: true',
    'guidelines:',
    '  - Prefer compact shell output when rtk is installed.',
    '```',
  ].join('\n');
}

function createValidatorPlugin(content: string): jest.Mocked<StewardPlugin> {
  const plugin = {
    settings: { stewardFolder: 'Steward' },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
    },
    app: {
      metadataCache: {
        getFileCache: jest.fn().mockImplementation(() => ({
          sections: buildMarkdownSections(content),
          frontmatter: { enabled: true },
        })),
      },
      vault: {
        read: jest.fn().mockResolvedValue(content),
        getFileByPath: jest.fn(),
        create: jest.fn(),
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

describe('ToolInstructionService', () => {
  const file = { path: 'Steward/Memory/Tool instructions.md' } as TFile;

  beforeEach(() => {
    (ToolInstructionService as unknown as { instance: ToolInstructionService | null }).instance =
      null;
  });

  it('validates a correct tool_instruction block and caches guidelines', () => {
    const content = buildValidToolInstructionsMd();
    const plugin = createValidatorPlugin(content);
    const service = ToolInstructionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(true);
    expect(validation.guidelinesByTool.get(ToolName.SHELL)).toEqual([
      'Prefer compact shell output when rtk is installed.',
    ]);
  });

  it('rejects invalid tool names', () => {
    const content = [
      'Tool instructions note.',
      '',
      '```yaml',
      'name: tool_instruction',
      'tool: not_a_real_tool',
      'guidelines:',
      '  - bad',
      '```',
    ].join('\n');
    const plugin = createValidatorPlugin(content);
    const service = ToolInstructionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.guidelinesByTool.size).toBe(0);
  });

  it('reports unsupported block names', () => {
    const content = [
      'Tool instructions note.',
      '',
      '```yaml',
      'name: manifest',
      'entry: index.html',
      '```',
    ].join('\n');
    const plugin = createValidatorPlugin(content);
    const service = ToolInstructionService.getInstance(plugin);

    const validation = service.validateContent({ content, file });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some(error => error.includes('unsupported block name'))).toBe(true);
  });

  it('creates the default file only when missing', async () => {
    const plugin = createValidatorPlugin('');
    plugin.app.vault.getFileByPath = jest.fn().mockReturnValue(null);
    plugin.app.vault.create = jest.fn().mockResolvedValue(undefined);
    const service = ToolInstructionService.getInstance(plugin);

    await service.ensureMemoryFolderAndDefaultFile();

    expect(plugin.obsidianAPITools.ensureFolderExists).toHaveBeenCalledWith('Steward/Memory');
    expect(plugin.app.vault.create).toHaveBeenCalledWith(
      'Steward/Memory/Tool instructions.md',
      expect.stringContaining('name: tool_instruction')
    );
  });

  it('default file content has no frontmatter (validation adds it)', async () => {
    const plugin = createValidatorPlugin('');
    plugin.app.vault.getFileByPath = jest.fn().mockReturnValue(null);
    let createdContent = '';
    plugin.app.vault.create = jest.fn().mockImplementation((_path: string, content: string) => {
      createdContent = content;
      return Promise.resolve(undefined);
    });
    const service = ToolInstructionService.getInstance(plugin);

    await service.ensureMemoryFolderAndDefaultFile();

    expect(createdContent).not.toContain('---\nstatus:');
    expect(createdContent).toContain('Add additional guidelines for this tool here');
    expect(createdContent.indexOf('Add additional guidelines')).toBeLessThan(
      createdContent.indexOf('```yaml')
    );
  });

  it('mergeToolGuidelineMaps appends secondary guidelines after primary', () => {
    const plugin = createValidatorPlugin('');
    const service = ToolInstructionService.getInstance(plugin);
    const primary = new Map<ToolName, string[]>([[ToolName.SHELL, ['rule a']]]);
    const secondary = new Map<ToolName, string[]>([[ToolName.SHELL, ['rule b']]]);

    const merged = service.mergeToolGuidelineMaps(primary, secondary);

    expect(merged.get(ToolName.SHELL)).toEqual(['rule a', 'rule b']);
  });
});
