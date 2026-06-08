import { TFile } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService, stringifyYamlFence } from './MarkdownDefinitionService';

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

    if (line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)) {
      sections.push({
        type: 'heading',
        position: {
          start: { line: lineIndex, col: 0, offset: 0 },
          end: { line: lineIndex, col: line.length, offset: 0 },
        },
      });
    }

    lineIndex++;
  }

  return sections;
}

function createTestPlugin(): jest.Mocked<StewardPlugin> {
  const plugin = {
    app: {
      metadataCache: {
        getFileCache: jest.fn(),
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;

  return {
    ...plugin,
    markdownDefinitionService: MarkdownDefinitionService.getInstance(plugin),
  } as jest.Mocked<StewardPlugin>;
}

describe('MarkdownDefinitionService', () => {
  beforeEach(() => {
    (MarkdownDefinitionService as unknown as { instance?: MarkdownDefinitionService }).instance =
      undefined;
  });

  describe('collectYamlBlocks', () => {
    it('collects YAML blocks matching isMatch', () => {
      const plugin = createTestPlugin();
      const service = MarkdownDefinitionService.getInstance(plugin);
      const content = ['```yaml', 'name: manifest', 'entry: index.html', '```'].join('\n');
      const file = getInstance(TFile, { path: 'test.md', extension: 'md' });

      plugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue({
        sections: buildMarkdownSections(content),
      });

      const blocks = service.collectYamlBlocks({
        file,
        content,
        isMatch: data => data.name === 'manifest',
      });

      expect(blocks).toHaveLength(1);
      expect(blocks[0].data).toEqual({ name: 'manifest', entry: 'index.html' });
    });

    it('ignores non-yaml fences and blocks that fail isMatch', () => {
      const plugin = createTestPlugin();
      const service = MarkdownDefinitionService.getInstance(plugin);
      const content = ['```js', 'console.log(1)', '```', '', '```yaml', 'name: other', '```'].join(
        '\n'
      );
      const file = getInstance(TFile, { path: 'test.md', extension: 'md' });

      plugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue({
        sections: buildMarkdownSections(content),
      });

      const blocks = service.collectYamlBlocks({
        file,
        content,
        isMatch: data => data.name === 'manifest',
      });

      expect(blocks).toHaveLength(0);
    });

    it('skips code sections when shouldSkipCodeSection returns true', () => {
      const plugin = createTestPlugin();
      const service = MarkdownDefinitionService.getInstance(plugin);
      const content = ['```yaml', 'command_name: skipped', '```'].join('\n');
      const file = getInstance(TFile, { path: 'test.md', extension: 'md' });

      plugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue({
        sections: buildMarkdownSections(content),
      });

      const blocks = service.collectYamlBlocks({
        file,
        content,
        isMatch: data => typeof data.command_name === 'string',
        shouldSkipCodeSection: () => true,
      });

      expect(blocks).toHaveLength(0);
    });
  });

  describe('replaceYamlFenceContents', () => {
    it('replaces inner YAML and normalizes the opening fence to ```yaml', () => {
      const plugin = createTestPlugin();
      const service = MarkdownDefinitionService.getInstance(plugin);
      const content = ['Intro', '```yml', 'old: 1', '```', 'Outro'].join('\n');

      const updated = service.replaceYamlFenceContents(content, [
        {
          block: { content: 'old: 1', startLine: 1, endLine: 3 },
          newInner: 'new: 2',
        },
      ]);

      expect(updated).toBe(['Intro', '```yaml', 'new: 2', '```', 'Outro'].join('\n'));
    });
  });

  describe('buildYamlFence and stringifyYamlFence', () => {
    it('builds a yaml fence from inner content', () => {
      const plugin = createTestPlugin();
      const service = MarkdownDefinitionService.getInstance(plugin);

      expect(service.buildYamlFence('name: manifest\nentry: index.html')).toBe(
        '```yaml\nname: manifest\nentry: index.html\n```'
      );
    });

    it('stringifies objects as YAML', () => {
      const yaml = stringifyYamlFence({ name: 'manifest', entry: 'index.html' });
      expect(yaml).toContain('name: manifest');
      expect(yaml).toContain('entry: index.html');
    });
  });
});
