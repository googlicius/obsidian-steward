import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { execute, GrepArgs } from './grep';
import type StewardPlugin from 'src/main';

function createMockPlugin(fileContent = ''): jest.Mocked<StewardPlugin> {
  // Create mock file
  const mockFile = new TFile();

  const app = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(fileContent),
      getAbstractFileByPath: jest.fn().mockReturnValue(null),
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

describe('grep', () => {
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
        paths: ['test-file.md'],
        pattern: 'test',
        explanation: 'Looking for test occurrences',
      };

      const result = await execute(args, mockPlugin);

      expect(result.content).toMatchObject({
        filePath: expect.any(String),
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
        paths: ['test-file.md'],
        pattern: 'multi\nline',
        explanation: 'Looking for patterns with actual newlines',
      };

      const result = await execute(args, mockPlugin);

      expect(result.content).toMatchObject({
        filePath: expect.any(String),
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

    it('should include an error when file is not found', async () => {
      const mockPluginWithNoFile = createMockPlugin();
      mockPluginWithNoFile.mediaTools.findFileByNameOrPath = jest.fn().mockResolvedValue(null);

      const args: GrepArgs = {
        paths: ['non-existent-file.md'],
        pattern: 'test',
        explanation: 'Testing file not found',
      };

      await expect(execute(args, mockPluginWithNoFile)).resolves.toMatchObject({
        content: {
          error: 'Note not found: non-existent-file.md',
          filePath: 'non-existent-file.md',
          matches: [],
          pattern: 'test',
          totalMatches: 0,
        },
      });
    });
  });

  describe('execute - path existence checking', () => {
    it('should return exists: false for non-existent paths', async () => {
      const mockPlugin = createMockPlugin();
      mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockReturnValue(null);
      mockPlugin.mediaTools.findFileByNameOrPath = jest.fn().mockResolvedValue(null);

      const args: GrepArgs = {
        paths: ['non-existent-file.md', 'another-missing-file.md'],
        explanation: 'Checking if files exist',
      };
      const result = await execute(args, mockPlugin);

      expect(result.paths).toEqual([
        {
          path: 'non-existent-file.md',
          exists: false,
          type: null,
        },
        {
          path: 'another-missing-file.md',
          exists: false,
          type: null,
        },
      ]);
    });

    it('should identify existing files correctly', async () => {
      const mockPlugin = createMockPlugin();
      const mockFile = new TFile();
      mockFile.path = 'existing-file.md';
      mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'existing-file.md') {
          return mockFile;
        }
        return null;
      });
      mockPlugin.mediaTools.findFileByNameOrPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'existing-file.md') {
          return Promise.resolve(mockFile);
        }
        return Promise.resolve(null);
      });

      const args: GrepArgs = {
        paths: ['existing-file.md', 'non-existent-file.md'],
        explanation: 'Checking file existence',
      };
      const result = await execute(args, mockPlugin);

      expect(result.paths).toEqual([
        {
          path: 'existing-file.md',
          exists: true,
          type: 'file',
        },
        {
          path: 'non-existent-file.md',
          exists: false,
          type: null,
        },
      ]);
    });

    it('should identify existing folders correctly', async () => {
      const mockPlugin = createMockPlugin();
      const mockFolder = new TFolder();
      mockFolder.path = 'existing-folder';
      mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'existing-folder') {
          return mockFolder;
        }
        return null;
      });
      mockPlugin.mediaTools.findFileByNameOrPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'existing-folder') {
          return Promise.resolve(mockFolder);
        }
        return Promise.resolve(null);
      });

      const args: GrepArgs = {
        paths: ['existing-folder', 'non-existent-folder'],
        explanation: 'Checking folder existence',
      };
      const result = await execute(args, mockPlugin);

      expect(result.paths).toEqual([
        {
          path: 'existing-folder',
          exists: true,
          type: 'folder',
        },
        {
          path: 'non-existent-folder',
          exists: false,
          type: null,
        },
      ]);
    });

    it('should handle mixed files and folders', async () => {
      const mockPlugin = createMockPlugin();
      const mockFile = new TFile();
      mockFile.path = 'file.md';
      const mockFolder = new TFolder();
      mockFolder.path = 'folder';
      mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'file.md') {
          return mockFile;
        }
        if (path === 'folder') {
          return mockFolder;
        }
        return null;
      });
      mockPlugin.mediaTools.findFileByNameOrPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'file.md') {
          return Promise.resolve(mockFile);
        }
        if (path === 'folder') {
          return Promise.resolve(mockFolder);
        }
        return Promise.resolve(null);
      });

      const args: GrepArgs = {
        paths: ['file.md', 'folder', 'missing.md'],
        explanation: 'Checking mixed paths',
      };
      const result = await execute(args, mockPlugin);

      expect(result.paths).toEqual([
        {
          path: 'file.md',
          exists: true,
          type: 'file',
        },
        {
          path: 'folder',
          exists: true,
          type: 'folder',
        },
        {
          path: 'missing.md',
          exists: false,
          type: null,
        },
      ]);
    });

    it('should check multiple paths in one call', async () => {
      const mockPlugin = createMockPlugin();
      const mockFile1 = new TFile();
      mockFile1.path = 'file1.md';
      const mockFile2 = new TFile();
      mockFile2.path = 'file2.md';
      const mockFolder = new TFolder();
      mockFolder.path = 'folder';
      mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'file1.md') {
          return mockFile1;
        }
        if (path === 'file2.md') {
          return mockFile2;
        }
        if (path === 'folder') {
          return mockFolder;
        }
        return null;
      });
      mockPlugin.mediaTools.findFileByNameOrPath = jest.fn().mockImplementation((path: string) => {
        if (path === 'file1.md') {
          return Promise.resolve(mockFile1);
        }
        if (path === 'file2.md') {
          return Promise.resolve(mockFile2);
        }
        if (path === 'folder') {
          return Promise.resolve(mockFolder);
        }
        return Promise.resolve(null);
      });

      const args: GrepArgs = {
        paths: ['file1.md', 'file2.md', 'folder', 'missing.md'],
        explanation: 'Checking multiple paths',
      };
      const result = await execute(args, mockPlugin);

      expect(result.paths).toEqual([
        {
          path: 'file1.md',
          exists: true,
          type: 'file',
        },
        {
          path: 'file2.md',
          exists: true,
          type: 'file',
        },
        {
          path: 'folder',
          exists: true,
          type: 'folder',
        },
        {
          path: 'missing.md',
          exists: false,
          type: null,
        },
      ]);
    });

    it('should search content when pattern is provided with single path', async () => {
      const fileContent = `Some content
This is a test
More content here`;

      const mockPlugin = createMockPlugin(fileContent);
      const mockFile = new TFile();
      mockFile.path = 'test-file.md';
      mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockReturnValue(mockFile);
      mockPlugin.mediaTools.findFileByNameOrPath = jest.fn().mockResolvedValue(mockFile);

      const args: GrepArgs = {
        paths: ['test-file.md'],
        pattern: 'test',
        explanation: 'Searching for test pattern',
      };

      const result = await execute(args, mockPlugin);

      expect(result.content).toBeDefined();
      if (result.content) {
        expect(result.content.totalMatches).toBe(1);
      }
      expect(result.paths).toBeUndefined();
    });
  });
});
