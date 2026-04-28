import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type StewardPlugin from 'src/main';
import { VaultService } from 'src/services/VaultService/VaultService';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { VaultExists, type ExistsToolArgs } from './VaultExists';

function createMockPlugin(params: {
  files?: TFile[];
  pathMap?: Record<string, TFile | TFolder>;
  adapter?: { exists: jest.Mock; stat: jest.Mock };
}): jest.Mocked<StewardPlugin> {
  const files = params.files ?? [];
  const pathMap = params.pathMap ?? {};
  const adapter = params.adapter ?? {
    exists: jest.fn().mockResolvedValue(false),
    stat: jest.fn().mockResolvedValue(null),
  };

  const app = {
    vault: {
      getAbstractFileByPath: jest.fn().mockImplementation((path: string) => pathMap[path] ?? null),
      adapter,
    },
    workspace: {
      getActiveFile: jest.fn().mockReturnValue(null),
    },
  } as unknown as App;

  const plugin = {
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
    get vaultService() {
      return VaultService.getInstance(plugin as unknown as StewardPlugin);
    },
  };
  return plugin as unknown as jest.Mocked<StewardPlugin>;
}

function createFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  return Object.assign(new TFile(), { path, name });
}

function createFolder(path: string): TFolder {
  const name = path.split('/').pop() ?? path;
  return Object.assign(new TFolder(), { path, name });
}

function setupExecuteExists(params: {
  files?: string[];
  pathMap?: Record<string, TFile | TFolder>;
  adapter?: { exists: jest.Mock; stat: jest.Mock };
}) {
  const files = (params.files ?? []).map(path => createFile(path));
  const plugin = createMockPlugin({
    files,
    pathMap: params.pathMap,
    adapter: params.adapter,
  });
  const mockAgent = { plugin } as unknown as AgentHandlerContext;
  const vaultExists = new VaultExists(mockAgent);

  return vaultExists['executeExists'].bind(vaultExists) as (args: ExistsToolArgs) => Promise<{
    paths: Array<{
      path: string;
      exists: boolean;
      type: 'file' | 'folder' | null;
    }>;
  }>;
}

describe('VaultExists', () => {
  it('returns file existence when found by exact path', async () => {
    const file = createFile('src/note.md');
    const executeExists = setupExecuteExists({
      pathMap: {
        'src/note.md': file,
      },
    });

    const result = await executeExists({
      paths: ['src/note.md'],
    });

    expect(result.paths).toEqual([
      {
        path: 'src/note.md',
        exists: true,
        type: 'file',
      },
    ]);
  });

  it('returns folder existence when found by exact path', async () => {
    const folder = createFolder('src/docs');
    const executeExists = setupExecuteExists({
      pathMap: {
        'src/docs': folder,
      },
    });

    const result = await executeExists({
      paths: ['src/docs'],
    });

    expect(result.paths).toEqual([
      {
        path: 'src/docs',
        exists: true,
        type: 'folder',
      },
    ]);
  });

  it('falls back to find file by name and returns not found paths', async () => {
    const executeExists = setupExecuteExists({
      files: ['Project Plan.md'],
    });

    const result = await executeExists({
      paths: ['Project Plan.md', 'missing.md'],
    });

    expect(result.paths).toEqual([
      {
        path: 'Project Plan.md',
        exists: true,
        type: 'file',
      },
      {
        path: 'missing.md',
        exists: false,
        type: null,
      },
    ]);
  });

  it('uses the vault adapter when the path is hidden from the abstract file tree (e.g. dot-prefixed)', async () => {
    const exists = jest
      .fn()
      .mockImplementation((p: string) => Promise.resolve(p === '.steward/config.md'));
    const stat = jest
      .fn()
      .mockImplementation((p: string) =>
        p === '.steward/config.md'
          ? Promise.resolve({ type: 'file' as const, ctime: 0, mtime: 0, size: 1 })
          : Promise.resolve(null)
      );

    const executeExists = setupExecuteExists({
      pathMap: {},
      adapter: { exists, stat },
    });

    const result = await executeExists({
      paths: ['.steward/config.md'],
    });

    expect(result.paths).toEqual([
      {
        path: '.steward/config.md',
        exists: true,
        type: 'file',
      },
    ]);
    expect(exists).toHaveBeenCalledWith('.steward/config.md');
  });
});
