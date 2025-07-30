import { ObsidianAPITools } from './obsidianAPITools';
import { App, TFile, TFolder } from 'obsidian';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { MoveOperationV2 } from './obsidianAPITools';
import { getInstance } from 'src/utils/getInstance';

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
      jest.spyOn(app.vault, 'getFileByPath').mockReturnValue(file);

      // Mock folder doesn't exist initially, then exists after creation
      jest
        .spyOn(app.vault, 'getFolderByPath')
        .mockReturnValueOnce(null)
        .mockReturnValueOnce({} as TFolder);

      // Mock successful file operations
      jest.spyOn(app.vault, 'createFolder').mockResolvedValue({} as TFolder);
      jest.spyOn(app.fileManager, 'renameFile').mockResolvedValue(undefined);

      const operations: MoveOperationV2[] = [
        {
          destinationFolder: 'destination',
          keywords: ['test'],
          tags: [],
          filenames: [],
          folders: [],
        },
      ];

      const filesByOperation = new Map<number, IndexedDocument[]>([
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
            } as IndexedDocument,
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
      // Mock file not found
      jest.spyOn(app.vault, 'getFileByPath').mockReturnValue(null);

      const operations: MoveOperationV2[] = [
        {
          destinationFolder: 'destination',
          keywords: ['test'],
          tags: [],
          filenames: [],
          folders: [],
        },
      ];

      const filesByOperation = new Map<number, IndexedDocument[]>([
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
            } as IndexedDocument,
          ],
        ],
      ]);

      const result = await obsidianAPITools.moveByOperations(operations, filesByOperation);

      expect(result).toMatchObject({
        operations: [
          {
            destinationFolder: 'destination',
            errors: ['non-existent-file.md'],
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
      const operations: MoveOperationV2[] = [
        {
          destinationFolder: 'current-folder',
          keywords: ['test'],
          tags: [],
          filenames: [],
          folders: [],
        },
      ];

      const filesByOperation = new Map<number, IndexedDocument[]>([
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
            } as IndexedDocument,
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

      // Verify that no file operations were called since the file is already in the destination
      expect(app.vault.getFileByPath).not.toHaveBeenCalled();
      expect(app.vault.createFolder).not.toHaveBeenCalled();
      expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });
  });
});
