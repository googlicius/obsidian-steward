import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { TFile, TFolder } from 'obsidian';
import type StewardPlugin from 'src/main';
import { getInstance } from 'src/utils/getInstance';
import { createDatasourceCompletionSource } from './datasourceCompletionSource';

function createMockPlugin(
  overrides: Partial<jest.Mocked<StewardPlugin>> = {}
): jest.Mocked<StewardPlugin> {
  return {
    commandInputService: {
      getInputPrefix: jest.fn().mockReturnValue('general'),
    },
    app: {
      vault: {
        getFiles: jest.fn().mockReturnValue([]),
        getAllFolders: jest.fn().mockReturnValue([]),
        getFolderByPath: jest.fn().mockReturnValue(null),
        config: {
          userIgnoreFilters: [],
        },
      },
      workspace: {
        getMostRecentLeaf: jest.fn().mockReturnValue(null),
      },
    },
    settings: {
      excludedFolders: [],
    },
    ...overrides,
  } as unknown as jest.Mocked<StewardPlugin>;
}

function createContext(doc: string): CompletionContext {
  const state = EditorState.create({ doc });
  return {
    state,
    pos: doc.length,
  } as CompletionContext;
}

describe('datasourceCompletionSource', () => {
  it('filters datasource options by name from root scope', () => {
    const alphaFile = getInstance(TFile, {
      path: 'Docs/Alpha.md',
      name: 'Alpha.md',
    });
    const betaFile = getInstance(TFile, {
      path: 'Docs/Beta.md',
      name: 'Beta.md',
    });
    const alphaFolder = getInstance(TFolder, {
      path: 'Alpha Folder',
      name: 'Alpha Folder',
      children: [],
    });

    const plugin = createMockPlugin({
      app: {
        vault: {
          getFiles: jest.fn().mockReturnValue([alphaFile, betaFile]),
          getAllFolders: jest.fn().mockReturnValue([alphaFolder]),
          getFolderByPath: jest.fn().mockReturnValue(null),
          config: {
            userIgnoreFilters: [],
          },
        },
        workspace: {
          getMostRecentLeaf: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as Partial<jest.Mocked<StewardPlugin>>);

    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ @alp'));

    expect(result).not.toBeNull();
    expect(result?.options.map(option => option.label)).toEqual(['Docs/Alpha.md', 'Alpha Folder/']);
    expect(result?.from).toBe(2);
  });

  it('resolves datasource options from a specific folder when typing slash', () => {
    const helloFile = getInstance(TFile, {
      path: 'My folder/Hello.md',
      name: 'Hello.md',
    });
    const worldFile = getInstance(TFile, {
      path: 'My folder/World.md',
      name: 'World.md',
    });
    const subFolder = getInstance(TFolder, {
      path: 'My folder/Sub',
      name: 'Sub',
      children: [],
    });
    const targetFolder = getInstance(TFolder, {
      path: 'My folder',
      name: 'My folder',
      children: [helloFile, worldFile, subFolder],
    });

    const plugin = createMockPlugin({
      app: {
        vault: {
          getFiles: jest.fn().mockReturnValue([helloFile, worldFile]),
          getAllFolders: jest.fn().mockReturnValue([targetFolder, subFolder]),
          getFolderByPath: jest.fn().mockImplementation((path: string) => {
            if (path === 'My folder') {
              return targetFolder;
            }
            return null;
          }),
          config: {
            userIgnoreFilters: [],
          },
        },
        workspace: {
          getMostRecentLeaf: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as Partial<jest.Mocked<StewardPlugin>>);

    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ @My folder/h'));

    expect(result).not.toBeNull();
    expect(result?.options.map(option => option.label)).toEqual(['My folder/Hello.md']);
  });

  it('resolves encoded folder paths when user types percent-encoded spaces', () => {
    const helloFile = getInstance(TFile, {
      path: 'My folder/Hello.md',
      name: 'Hello.md',
    });
    const targetFolder = getInstance(TFolder, {
      path: 'My folder',
      name: 'My folder',
      children: [helloFile],
    });

    const plugin = createMockPlugin({
      app: {
        vault: {
          getFiles: jest.fn().mockReturnValue([helloFile]),
          getAllFolders: jest.fn().mockReturnValue([targetFolder]),
          getFolderByPath: jest.fn().mockImplementation((path: string) => {
            if (path === 'My folder') {
              return targetFolder;
            }
            return null;
          }),
          config: {
            userIgnoreFilters: [],
          },
        },
        workspace: {
          getMostRecentLeaf: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as Partial<jest.Mocked<StewardPlugin>>);

    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ @My%20folder/he'));

    expect(result).not.toBeNull();
    expect(result?.options.map(option => option.label)).toEqual(['My folder/Hello.md']);
  });

  it('excludes datasource options based on vault and plugin exclusion patterns', () => {
    const privateFile = getInstance(TFile, {
      path: 'Private/Alpha.md',
      name: 'Alpha.md',
    });
    const publicFile = getInstance(TFile, {
      path: 'Public/Alpha.md',
      name: 'Alpha.md',
    });
    const privateFolder = getInstance(TFolder, {
      path: 'Private',
      name: 'Private',
      children: [],
    });
    const publicFolder = getInstance(TFolder, {
      path: 'Public',
      name: 'Public',
      children: [],
    });

    const plugin = createMockPlugin({
      app: {
        vault: {
          getFiles: jest.fn().mockReturnValue([privateFile, publicFile]),
          getAllFolders: jest.fn().mockReturnValue([privateFolder, publicFolder]),
          getFolderByPath: jest.fn().mockReturnValue(null),
          config: {
            userIgnoreFilters: ['Private'],
          },
        },
        workspace: {
          getMostRecentLeaf: jest.fn().mockReturnValue(null),
        },
      },
      settings: {
        excludedFolders: ['Secret'],
      },
    } as unknown as Partial<jest.Mocked<StewardPlugin>>);

    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ @alp'));

    expect(result).not.toBeNull();
    expect(result?.options.map(option => option.label)).toEqual(['Public/Alpha.md']);
  });

  it('returns null when folder path cannot be resolved', () => {
    const plugin = createMockPlugin({
      app: {
        vault: {
          getFiles: jest.fn().mockReturnValue([]),
          getAllFolders: jest.fn().mockReturnValue([]),
          getFolderByPath: jest.fn().mockReturnValue(null),
          config: {
            userIgnoreFilters: [],
          },
        },
        workspace: {
          getMostRecentLeaf: jest.fn().mockReturnValue(null),
        },
      },
    } as unknown as Partial<jest.Mocked<StewardPlugin>>);

    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ @Missing/he'));

    expect(result).toBeNull();
  });

  it('returns null when @ is not preceded by a space', () => {
    const plugin = createMockPlugin();
    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ note@alp'));

    expect(result).toBeNull();
  });

  it('returns null when it is an email', () => {
    const plugin = createMockPlugin();
    const source = createDatasourceCompletionSource(plugin);
    const result = source(createContext('/ myname@gmail.com'));

    expect(result).toBeNull();
  });
});
