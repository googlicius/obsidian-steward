import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { execute, GrepArgs } from './grepContent';
import type StewardPlugin from 'src/main';

function createMockPlugin(fileContent = ''): jest.Mocked<StewardPlugin> {
  // Create mock file
  const mockFile = new TFile();

  const app = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(fileContent),
    },
    workspace: {
      getActiveFile: jest.fn().mockReturnValue(mockFile),
    },
  } as unknown as App;

  return {
    app,
    mediaTools: {
      findFileByNameOrPath: jest.fn().mockResolvedValue(mockFile),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('grepContent', () => {
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
  });

  describe('execute', () => {
    it('should find matches and return context with surrounding lines', async () => {
      const fileContent = `Some content
This is a test
More content here
Another test line
Final content`;

      mockPlugin = createMockPlugin(fileContent);

      const args: GrepArgs = {
        pattern: 'test',
        explanation: 'Looking for test occurrences',
      };

      const result = await execute(args, mockPlugin);

      expect(result).toMatchObject({
        filePath: '',
        matches: [
          {
            content: 'test',
            fromLine: 1,
            toLine: 1,
          },
          {
            content: 'test',
            fromLine: 3,
            toLine: 3,
          },
        ],
        pattern: 'test',
        totalMatches: 2,
      });
    });

    it('should find matches for patterns that include newlines', async () => {
      const fileContent = `Some content
This is a multi
line search pattern
Another test line
More content here
This is also a multi
line pattern to find`;

      mockPlugin = createMockPlugin(fileContent);

      const args: GrepArgs = {
        pattern: 'multi\nline',
        explanation: 'Looking for patterns with actual newlines',
      };

      const result = await execute(args, mockPlugin);

      expect(result).toMatchObject({
        filePath: '',
        matches: [
          {
            content: 'multi\nline',
            fromLine: 1,
            toLine: 2,
          },
          {
            content: 'multi\nline',
            fromLine: 5,
            toLine: 6,
          },
        ],
        pattern: 'multi\nline',
        totalMatches: 2,
      });
    });

    it('should throw an error when file is not found', async () => {
      const mockPluginWithNoFile = createMockPlugin();
      mockPluginWithNoFile.mediaTools.findFileByNameOrPath = jest.fn().mockResolvedValue(null);

      const args: GrepArgs = {
        pattern: 'test',
        filePath: 'non-existent-file.md',
        explanation: 'Testing file not found',
      };

      await expect(execute(args, mockPluginWithNoFile)).rejects.toThrow(
        'Note not found: non-existent-file.md'
      );
    });
  });
});
