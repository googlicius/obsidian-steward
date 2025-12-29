import { VaultList } from './VaultList';
import { type SuperAgent } from '../SuperAgent';
import { TFile, TFolder } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';
import type StewardPlugin from 'src/main';
import { IMAGE_EXTENSIONS } from 'src/constants';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    app: {
      vault: {
        getFolderByPath: jest.fn(),
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('VaultList', () => {
  let vaultList: VaultList;
  let mockAgent: jest.Mocked<SuperAgent>;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    mockAgent = {
      app: mockPlugin.app,
    } as unknown as jest.Mocked<SuperAgent>;
    vaultList = new VaultList(mockAgent);
  });

  describe('executeListTool', () => {
    let executeListTool: VaultList['executeListTool'];

    beforeEach(() => {
      executeListTool = vaultList['executeListTool'].bind(vaultList);
    });

    it('should list all files', async () => {
      // Create mock files
      const file1 = getInstance(TFile, {
        path: 'folder/file1.md',
        name: 'file1.md',
      });
      const file2 = getInstance(TFile, {
        path: 'folder/file2.txt',
        name: 'file2.txt',
      });
      const file3 = getInstance(TFile, {
        path: 'folder/image.png',
        name: 'image.png',
      });

      // Create mock folder with files
      const mockFolder = getInstance(TFolder, {
        path: 'folder',
        children: [file1, file2, file3],
      });

      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockFolder);

      const result = await executeListTool({ folderPath: 'folder' }, null);

      expect(result.files).toEqual(['folder/file1.md', 'folder/file2.txt', 'folder/image.png']);
      expect(result.errors).toBeUndefined();
    });

    it('should list all images', async () => {
      // Create mock files
      const file1 = getInstance(TFile, {
        path: 'folder/image1.png',
        name: 'image1.png',
      });
      const file2 = getInstance(TFile, {
        path: 'folder/image2.jpg',
        name: 'image2.jpg',
      });
      const file3 = getInstance(TFile, {
        path: 'folder/document.md',
        name: 'document.md',
      });

      // Create mock folder with files
      const mockFolder = getInstance(TFolder, {
        path: 'folder',
        children: [file1, file2, file3],
      });

      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockFolder);

      // Pattern to match image files using shared extensions
      const result = await executeListTool(
        {
          folderPath: 'folder',
          filePattern: `\\.(${IMAGE_EXTENSIONS.join('|')})$`,
        },
        null
      );

      expect(result.files).toEqual(['folder/image1.png', 'folder/image2.jpg']);
      expect(result.errors).toBeUndefined();
    });

    it('should list all files containing either of two specific words', async () => {
      // Create mock files
      const file1 = getInstance(TFile, {
        path: 'folder/test-file.md',
        name: 'test-file.md',
      });
      const file2 = getInstance(TFile, {
        path: 'folder/example.md',
        name: 'example.md',
      });
      const file3 = getInstance(TFile, {
        path: 'folder/demo.txt',
        name: 'demo.txt',
      });
      const file4 = getInstance(TFile, {
        path: 'folder/other.md',
        name: 'other.md',
      });

      // Create mock folder with files
      const mockFolder = getInstance(TFolder, {
        path: 'folder',
        children: [file1, file2, file3, file4],
      });

      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockFolder);

      // Pattern to match files containing "test" or "demo"
      const result = await executeListTool(
        { folderPath: 'folder', filePattern: '(test|demo)' },
        null
      );

      expect(result.files).toEqual(['folder/test-file.md', 'folder/demo.txt']);
      expect(result.errors).toBeUndefined();
    });

    it('should return error for invalid regex pattern', async () => {
      // Create mock folder (not needed for this test, but keeping structure consistent)
      const mockFolder = getInstance(TFolder, {
        path: 'folder',
        children: [],
      });

      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockFolder);

      // Invalid regex pattern: unclosed bracket
      const result = await executeListTool({ folderPath: 'folder', filePattern: '[invalid' }, null);

      expect(result.files).toEqual([]);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBe(1);
      expect(result.errors?.[0]).toContain('Invalid RegExp pattern');
      expect(result.errors?.[0]).toContain('[invalid');
    });

    it('should return error when folder does not exist', async () => {
      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(null);

      const result = await executeListTool({ folderPath: 'non-existent-folder' }, null);

      expect(result.files).toEqual([]);
      expect(result.errors).toEqual(['Folder not found: non-existent-folder']);
    });

    it('should list files in root folder when folderPath is empty string', async () => {
      // Create mock files at root level
      const file1 = getInstance(TFile, {
        path: 'root-file1.md',
        name: 'root-file1.md',
      });

      // Create mock root folder with files
      const mockRootFolder = getInstance(TFolder, {
        path: '/',
        children: [file1],
      });

      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockRootFolder);

      const result = await executeListTool({ folderPath: '' }, null);

      expect(result.files).toEqual(['root-file1.md']);
      expect(result.errors).toBeUndefined();
      expect(mockPlugin.app.vault.getFolderByPath).toHaveBeenCalledWith('/');
    });

    it('should list files in root folder when folderPath is forward slash', async () => {
      // Create mock files at root level
      const file1 = getInstance(TFile, {
        path: 'root-file1.md',
        name: 'root-file1.md',
      });
      // Create mock root folder with files
      const mockRootFolder = getInstance(TFolder, {
        path: '/',
        children: [file1],
      });

      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockRootFolder);

      const result = await executeListTool({ folderPath: '/' }, null);

      expect(result.files).toEqual(['root-file1.md']);
      expect(result.errors).toBeUndefined();
      expect(mockPlugin.app.vault.getFolderByPath).toHaveBeenCalledWith('/');
    });
  });
});
