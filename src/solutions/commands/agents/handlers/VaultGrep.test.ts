import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type StewardPlugin from 'src/main';
import { VaultGrep, grepSchema, type GrepToolArgs } from './VaultGrep';
import type { AgentHandlerContext } from '../AgentHandlerContext';

function createArgs(
  overrides: Partial<GrepToolArgs> & Pick<GrepToolArgs, 'contentPattern'>
): GrepToolArgs {
  return {
    paths: ['src'],
    caseSensitive: true,
    isRegex: false,
    contextLines: 0,
    maxResults: 50,
    ...overrides,
  };
}

function createMockPlugin(params: {
  files?: TFile[];
  fileContentByPath?: Record<string, string>;
  pathMap?: Record<string, TFile | TFolder>;
}): jest.Mocked<StewardPlugin> {
  const fileContentByPath = params.fileContentByPath ?? {};
  const files = params.files ?? [];
  const pathMap = params.pathMap ?? {};

  const app = {
    vault: {
      cachedRead: jest.fn().mockImplementation((file: TFile) => {
        return Promise.resolve(fileContentByPath[file.path] ?? '');
      }),
      getAbstractFileByPath: jest.fn().mockImplementation((path: string) => pathMap[path] ?? null),
      getFiles: jest.fn().mockReturnValue(files),
    },
    workspace: {
      getActiveFile: jest.fn().mockReturnValue(null),
    },
  } as unknown as App;

  return {
    app,
    mediaTools: {
      findFileByNameOrPath: jest.fn().mockImplementation((path: string) => {
        for (const file of files) {
          if (file.path === path || file.name === path) {
            return Promise.resolve(file);
          }
        }

        return Promise.resolve(null);
      }),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

function createFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  return Object.assign(new TFile(), { path, name });
}

function createFolder(path: string): TFolder {
  const name = path.split('/').pop() ?? path;
  return Object.assign(new TFolder(), { path, name });
}

function setupExecuteGrep(params: {
  files: Array<{ path: string; content: string }>;
  pathMap?: Record<string, TFile | TFolder>;
}) {
  const files = params.files.map(file => createFile(file.path));
  const fileContentByPath: Record<string, string> = {};
  for (const file of params.files) {
    fileContentByPath[file.path] = file.content;
  }

  const plugin = createMockPlugin({
    files,
    fileContentByPath,
    pathMap: params.pathMap,
  });
  const mockAgent = {
    plugin,
    obsidianAPITools: {
      getFilesFromFolder: jest.fn().mockImplementation((folder: TFolder) => {
        const folderPrefix = `${folder.path}/`;
        const folderFiles: TFile[] = [];
        for (const file of files) {
          if (file.path.startsWith(folderPrefix)) {
            folderFiles.push(file);
          }
        }
        return folderFiles;
      }),
    },
  } as unknown as AgentHandlerContext;
  const vaultGrep = new VaultGrep(mockAgent);

  return vaultGrep['executeGrep'].bind(vaultGrep) as (args: GrepToolArgs) => Promise<{
    matches: Array<{
      file: string;
      line: number;
      content: string;
      contextBefore?: string[];
      contextAfter?: string[];
    }>;
    totalMatches: number;
    truncated: boolean;
    searchedFiles: number;
  }>;
}

describe('VaultGrep', () => {
  it('requires paths in schema', () => {
    const result = grepSchema.safeParse({
      contentPattern: 'useState',
    });

    expect(result.success).toBe(false);
  });

  it('supports searching files under a folder path', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        { path: 'src/note.md', content: 'useState in root note' },
        { path: 'src/view.canvas', content: 'contains useState in canvas' },
        { path: 'src/sub/deep.base', content: 'useState in nested base' },
      ],
      pathMap: {
        src: createFolder('src'),
      },
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'useState',
        paths: ['src'],
      })
    );

    expect(result.searchedFiles).toBe(3);
    expect(result.totalMatches).toBe(3);
  });

  it('supports multiple folder paths', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        { path: 'src/app.md', content: 'TODO: finalize app logic' },
        { path: 'tests/spec.canvas', content: 'TODO: visual test note' },
        { path: 'notes/backlog.base', content: 'TODO but outside selected globs' },
      ],
      pathMap: {
        src: createFolder('src'),
        tests: createFolder('tests'),
      },
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'TODO',
        paths: ['src', 'tests'],
      })
    );

    expect(result).toMatchObject({
      matches: [
        {
          file: 'src/app.md',
          line: 1,
          content: 'TODO: finalize app logic',
        },
        {
          file: 'tests/spec.canvas',
          line: 1,
          content: 'TODO: visual test note',
        },
      ],
      totalMatches: 2,
      truncated: false,
      searchedFiles: 2,
    });
  });

  it('supports searching a specific file path', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        { path: 'src/index.ts', content: 'export default function main() {}' },
        { path: 'src/other.md', content: 'export default should not be searched here' },
      ],
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'export default',
        paths: ['src/index.ts'],
      })
    );

    expect(result).toMatchObject({
      matches: [
        {
          file: 'src/index.ts',
          line: 1,
          content: 'export default function main() {}',
        },
      ],
      totalMatches: 1,
      truncated: false,
      searchedFiles: 1,
    });
  });

  it('rejects glob paths in schema', () => {
    const result = grepSchema.safeParse({
      contentPattern: 'console.log',
      paths: ['**/*.ts'],
    });

    expect(result.success).toBe(false);
  });

  it('supports regex search patterns', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        { path: 'src/functions.md', content: 'function alpha(' },
        { path: 'src/diagram.canvas', content: 'function beta(' },
        { path: 'src/config.base', content: 'const fn = () => {}' },
      ],
      pathMap: {
        src: createFolder('src'),
      },
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'function\\s+\\w+\\(',
        isRegex: true,
        paths: ['src'],
      })
    );

    expect(result).toMatchObject({
      matches: [
        { file: 'src/functions.md', line: 1, content: 'function alpha(' },
        { file: 'src/diagram.canvas', line: 1, content: 'function beta(' },
      ],
      totalMatches: 2,
      truncated: false,
      searchedFiles: 3,
    });
  });

  it('supports case-insensitive search', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        { path: 'src/one.md', content: 'todo: first item' },
        { path: 'src/two.base', content: 'TODO: second item' },
        { path: 'src/three.canvas', content: 'ToDo: third item' },
      ],
      pathMap: {
        src: createFolder('src'),
      },
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'todo',
        caseSensitive: false,
        paths: ['src'],
      })
    );

    expect(result.totalMatches).toBe(3);
  });

  it('returns context lines around matches', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        {
          path: 'src/errors.md',
          content: [
            'line 1',
            'line 2',
            'line 3',
            'throw new Error("bad")',
            'line 5',
            'line 6',
            'line 7',
          ].join('\n'),
        },
      ],
      pathMap: {
        src: createFolder('src'),
      },
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'throw new Error',
        contextLines: 3,
        paths: ['src'],
      })
    );

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0]).toEqual({
      file: 'src/errors.md',
      line: 4,
      content: 'throw new Error("bad")',
      contextBefore: ['line 1', 'line 2', 'line 3'],
      contextAfter: ['line 5', 'line 6', 'line 7'],
    });
  });

  it('caps returned matches with maxResults', async () => {
    const executeGrep = setupExecuteGrep({
      files: [
        {
          path: 'src/a.md',
          content: ['import a', 'import b', 'import c', 'import d', 'import e', 'import f'].join(
            '\n'
          ),
        },
        {
          path: 'src/b.canvas',
          content: ['import g', 'import h', 'import i', 'import j', 'import k', 'import l'].join(
            '\n'
          ),
        },
      ],
      pathMap: {
        src: createFolder('src'),
      },
    });

    const result = await executeGrep(
      createArgs({
        contentPattern: 'import',
        maxResults: 10,
        paths: ['src'],
      })
    );

    expect(result).toMatchObject({
      matches: [
        { file: 'src/a.md', line: 1, content: 'import a' },
        { file: 'src/a.md', line: 2, content: 'import b' },
        { file: 'src/a.md', line: 3, content: 'import c' },
        { file: 'src/a.md', line: 4, content: 'import d' },
        { file: 'src/a.md', line: 5, content: 'import e' },
        { file: 'src/a.md', line: 6, content: 'import f' },
        { file: 'src/b.canvas', line: 1, content: 'import g' },
        { file: 'src/b.canvas', line: 2, content: 'import h' },
        { file: 'src/b.canvas', line: 3, content: 'import i' },
        { file: 'src/b.canvas', line: 4, content: 'import j' },
      ],
      totalMatches: 12,
      truncated: true,
      searchedFiles: 2,
    });
  });

  it('returns explicit paths for guardrails checks', () => {
    const plugin = createMockPlugin({
      files: [],
    });
    const mockAgent = {
      plugin,
      obsidianAPITools: {
        getFilesFromFolder: jest.fn().mockReturnValue([]),
      },
    } as unknown as AgentHandlerContext;
    const vaultGrep = new VaultGrep(mockAgent);

    const paths = vaultGrep.extractPathsForGuardrails(
      createArgs({
        contentPattern: 'token',
        paths: ['Secret/token.key'],
      })
    );

    expect(paths).toEqual(['Secret/token.key']);
  });
});
