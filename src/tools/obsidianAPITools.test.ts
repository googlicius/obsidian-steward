import { ObsidianAPITools } from './obsidianAPITools';
import { App, TFile, TFolder } from 'obsidian';
import { MoveOperationV2 } from './obsidianAPITools';
import { getInstance } from 'src/utils/getInstance';
import { DocWithPath } from 'src/types/types';

// Mock the Obsidian modules
jest.mock('obsidian', () => ({
  App: jest.fn().mockImplementation(() => ({
    vault: {
      getFileByPath: jest.fn(),
      getFolderByPath: jest.fn(),
      createFolder: jest.fn().mockResolvedValue(undefined),
    },
    fileManager: {
      renameFile: jest.fn().mockResolvedValue(undefined),
    },
  })),
  TFile: jest.fn().mockImplementation(() => ({
    path: '',
    extension: '',
    name: '',
  })),
  TFolder: jest.fn().mockImplementation(() => ({
    path: '',
    name: '',
  })),
}));

describe('ObsidianAPITools', () => {
  let app: App;
  let obsidianAPITools: ObsidianAPITools;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create a new App instance for each test
    app = new App();
    obsidianAPITools = new ObsidianAPITools(app);
  });

  describe('moveByOperations', () => {
    it('should successfully move files to destination folder', async () => {
      // Mock file existence
      const file = getInstance(TFile, { path: 'test-file.md', name: 'test-file.md' });
      jest.spyOn(app.vault, 'getFileByPath').mockImplementation((path: string) => {
        if (path === 'test-file.md') {
          return file;
        }
        return null;
      });

      // Mock folder doesn't exist for destination folder
      jest.spyOn(app.vault, 'getFolderByPath').mockImplementation((path: string) => {
        if (path === 'destination') {
          return null; // Folder doesn't exist, should be created
        }
        return null;
      });

      // Mock successful file operations
      jest.spyOn(app.vault, 'createFolder').mockResolvedValue(new TFolder());
      jest.spyOn(app.fileManager, 'renameFile').mockResolvedValue(undefined);

      const operations: MoveOperationV2[] = [
        {
          destinationFolder: 'destination',
          keywords: ['test'],
          filenames: [],
          folders: [],
          properties: [],
        },
      ];

      const filesByOperation = new Map<number, DocWithPath[]>([
        [
          0,
          [
            {
              path: 'test-file.md',
              fileName: 'test-file',
              lastModified: 1234567890,
              tags: [],
              content: 'test content',
              title: 'Test File',
            } as DocWithPath,
          ],
        ],
      ]);

      const result = await obsidianAPITools.moveByOperations(operations, filesByOperation);

      expect(result).toMatchObject({
        operations: [
          {
            destinationFolder: 'destination',
            errors: [],
            moved: ['destination/test-file.md'],
            skipped: [],
            sourceQuery: 'test',
          },
        ],
      });

      // Verify the folder was created
      expect(app.vault.createFolder).toHaveBeenCalledWith('destination');

      // Verify the file was moved
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(file, 'destination/test-file.md');
    });

    it('should fail to move file when file is not found', async () => {
      // Mock file and folder not found
      jest.spyOn(app.vault, 'getFileByPath').mockReturnValue(null);
      jest.spyOn(app.vault, 'getFolderByPath').mockReturnValue(null);

      const operations: MoveOperationV2[] = [
        {
          destinationFolder: 'destination',
          keywords: ['test'],
          filenames: [],
          folders: [],
          properties: [],
        },
      ];

      const filesByOperation = new Map<number, DocWithPath[]>([
        [
          0,
          [
            {
              path: 'non-existent-file.md',
              fileName: 'non-existent-file',
              lastModified: 1234567890,
              tags: [],
              content: 'test content',
              title: 'Non Existent File',
            } as DocWithPath,
          ],
        ],
      ]);

      const result = await obsidianAPITools.moveByOperations(operations, filesByOperation);

      expect(result).toMatchObject({
        operations: [
          {
            destinationFolder: 'destination',
            errors: [{ path: 'non-existent-file.md', message: 'Item not found' }],
            moved: [],
            skipped: [],
            sourceQuery: 'test',
          },
        ],
      });

      // Verify that folder creation and file renaming were not called
      expect(app.vault.createFolder).not.toHaveBeenCalled();
      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('should skip moving file when source and destination are the same', async () => {
      // Mock file existence
      const file = getInstance(TFile, {
        path: 'current-folder/test-file.md',
        name: 'test-file.md',
      });
      jest.spyOn(app.vault, 'getFileByPath').mockReturnValue(file);

      const operations: MoveOperationV2[] = [
        {
          destinationFolder: 'current-folder',
          keywords: ['test'],
          filenames: [],
          folders: [],
          properties: [],
        },
      ];

      const filesByOperation = new Map<number, DocWithPath[]>([
        [
          0,
          [
            {
              path: 'current-folder/test-file.md',
              fileName: 'test-file',
              lastModified: 1234567890,
              tags: [],
              content: 'test content',
              title: 'Test File',
            } as DocWithPath,
          ],
        ],
      ]);

      const result = await obsidianAPITools.moveByOperations(operations, filesByOperation);

      expect(result).toMatchObject({
        operations: [
          {
            destinationFolder: 'current-folder',
            errors: [],
            moved: [],
            skipped: ['current-folder/test-file.md'],
            sourceQuery: 'test',
          },
        ],
      });

      // Verify that file was checked but no move operations were called since the file is already in the destination
      expect(app.vault.getFileByPath).toHaveBeenCalledWith('current-folder/test-file.md');
      expect(app.vault.createFolder).not.toHaveBeenCalled();
      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('should move file to the root folder', async () => {
      // Mock file existence
      const file = getInstance(TFile, { path: 'folder/test-file.md', name: 'test-file.md' });
      jest.spyOn(app.vault, 'getFileByPath').mockReturnValue(file);

      // Root folder should be considered as existing; no creation
      jest.spyOn(app.vault, 'getFolderByPath').mockReturnValue(new TFolder());

      // Mock successful file operations
      jest.spyOn(app.fileManager, 'renameFile').mockResolvedValue(undefined);

      const operations: MoveOperationV2[] = [
        {
          destinationFolder: '/',
          keywords: ['test'],
          filenames: [],
          folders: [],
          properties: [],
        },
      ];

      const filesByOperation = new Map<number, DocWithPath[]>([
        [
          0,
          [
            {
              path: 'folder/test-file.md',
              fileName: 'test-file',
              lastModified: 1234567890,
              tags: [],
              content: 'test content',
              title: 'Test File',
            } as DocWithPath,
          ],
        ],
      ]);

      const result = await obsidianAPITools.moveByOperations(operations, filesByOperation);

      expect(result).toMatchObject({
        operations: [
          {
            destinationFolder: '/',
            errors: [],
            moved: ['/test-file.md'],
            skipped: [],
            sourceQuery: 'test',
          },
        ],
      });

      // Verify that root folder wasn't created and file was moved correctly
      expect(app.vault.createFolder).not.toHaveBeenCalled();
      expect(app.fileManager.renameFile).toHaveBeenCalledWith(file, '/test-file.md');
    });
  });
});
