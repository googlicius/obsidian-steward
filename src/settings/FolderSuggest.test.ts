import { FolderSuggest } from './FolderSuggest';
import { App, TFolder } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';

// Mock AbstractInputSuggest
jest.mock('obsidian', () => {
  class MockTFolder {
    path = '';
    name = '';
    children: unknown[] = [];
  }

  class MockAbstractInputSuggest {
    app: App;
    inputEl: HTMLInputElement;
    constructor(app: App, inputEl: HTMLInputElement) {
      this.app = app;
      this.inputEl = inputEl;
    }
    close = jest.fn();
  }

  return {
    App: jest.fn().mockImplementation(() => ({
      vault: {
        getAllFolders: jest.fn(),
        getFolderByPath: jest.fn(),
      },
    })),
    TFolder: MockTFolder,
    AbstractInputSuggest: MockAbstractInputSuggest,
  };
});

describe('FolderSuggest', () => {
  let app: App;
  let inputEl: jest.Mocked<HTMLInputElement>;
  let folderSuggest: FolderSuggest;

  function createMockInputElement(): jest.Mocked<HTMLInputElement> {
    return {
      value: '',
      dispatchEvent: jest.fn(),
      blur: jest.fn(),
    } as unknown as jest.Mocked<HTMLInputElement>;
  }

  beforeEach(() => {
    jest.clearAllMocks();

    app = new App();
    inputEl = createMockInputElement();
    folderSuggest = new FolderSuggest(app, inputEl);
  });

  describe('getSuggestions', () => {
    it('should return all level 1 folders when query is empty', () => {
      const folder1 = getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
      const folder2 = getInstance(TFolder, { path: 'Folder2', name: 'Folder2', children: [] });
      const subfolder = getInstance(TFolder, { path: 'Folder1/Sub', name: 'Sub', children: [] });

      jest.spyOn(app.vault, 'getAllFolders').mockReturnValue([folder1, folder2, subfolder]);

      const result = folderSuggest.getSuggestions('');

      console.log('result', result);

      expect(result).toEqual([folder1, folder2]);
      expect(result).not.toContain(subfolder);
    });

    it('should filter level 1 folders by query when multiple matches exist', () => {
      const folder1 = getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
      const folder2 = getInstance(TFolder, { path: 'Folder2', name: 'Folder2', children: [] });
      const folder2_1 = getInstance(TFolder, { path: 'Folder2/01', name: '01', children: [] });
      const folder3 = getInstance(TFolder, { path: 'Other', name: 'Other', children: [] });

      jest.spyOn(app.vault, 'getAllFolders').mockReturnValue([folder1, folder2, folder3]);

      const result = folderSuggest.getSuggestions('Folder');

      expect(result).toEqual([folder1, folder2]);
      expect(result).not.toContain(folder2_1);
      expect(result).not.toContain(folder3);
    });

    it('should return direct subfolders when exactly one level 1 folder matches', () => {
      // const folder1 = getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
      const folder2 = getInstance(TFolder, { path: 'Folder2', name: 'Folder2', children: [] });
      const subfolder1 = getInstance(TFolder, { path: 'Folder1/Sub1', name: 'Sub1', children: [] });
      const subfolder2 = getInstance(TFolder, { path: 'Folder1/Sub2', name: 'Sub2', children: [] });
      const subfolder3 = getInstance(TFolder, { path: 'Folder2/Sub3', name: 'Sub3', children: [] });

      const folder1 = getInstance(TFolder, {
        path: 'Folder1',
        name: 'Folder1',
        children: [subfolder1, subfolder2],
      });

      jest
        .spyOn(app.vault, 'getAllFolders')
        .mockReturnValue([folder1, folder2, subfolder1, subfolder2, subfolder3]);
      jest.spyOn(app.vault, 'getFolderByPath').mockImplementation((path: string) => {
        if (path === 'Folder1') {
          return folder1;
        }
        return null;
      });

      const result = folderSuggest.getSuggestions('Folder1');

      expect(result).toEqual([folder1, subfolder1, subfolder2]);
      expect(result).not.toContain(subfolder3);

      // Test with query trailing with a slash
      const result2 = folderSuggest.getSuggestions('Folder1/');

      expect(result2).toEqual([subfolder1, subfolder2]);
      expect(result2).not.toContain(subfolder3);
    });

    it('should return matched folder when exactly one match has no subfolders', () => {
      const folder1 = getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
      const folder2 = getInstance(TFolder, { path: 'Folder2', name: 'Folder2', children: [] });

      jest.spyOn(app.vault, 'getAllFolders').mockReturnValue([folder1, folder2]);
      jest.spyOn(app.vault, 'getFolderByPath').mockImplementation((path: string) => {
        if (path === 'Folder1') {
          return getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
        }
        return null;
      });

      const result = folderSuggest.getSuggestions('Folder1');

      expect(result).toEqual([folder1]);
    });

    it('should handle case-insensitive query matching', () => {
      const folder1 = getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
      const folder2 = getInstance(TFolder, { path: 'Folder2', name: 'Folder2', children: [] });

      jest.spyOn(app.vault, 'getAllFolders').mockReturnValue([folder1, folder2]);

      const result = folderSuggest.getSuggestions('folder1');

      expect(result).toEqual([folder1]);
    });

    it('should exclude folders with slashes in path from level 1 results', () => {
      const folder1 = getInstance(TFolder, { path: 'Folder1', name: 'Folder1', children: [] });
      const subfolder = getInstance(TFolder, { path: 'Folder1/Sub', name: 'Sub', children: [] });
      const nested = getInstance(TFolder, {
        path: 'Folder1/Sub/Nested',
        name: 'Nested',
        children: [],
      });

      jest.spyOn(app.vault, 'getAllFolders').mockReturnValue([folder1, subfolder, nested]);

      const result = folderSuggest.getSuggestions('');

      expect(result).toEqual([folder1]);
      expect(result).not.toContain(subfolder);
      expect(result).not.toContain(nested);
    });
  });
});
