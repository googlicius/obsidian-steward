import {
  NodePtyInstallerScriptService,
  parseStewardInstallerMeta,
} from './NodePtyInstallerScriptService';
import type StewardPlugin from 'src/main';
import {
  NODE_PTY_INSTALLER_PS1_BASENAME,
  NODE_PTY_INSTALLER_SH_BASENAME,
} from 'src/constants/nodePtyInstallerConstants';

let isDesktopApp = true;

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    normalizePath: (p: string) => p.replace(/\\/g, '/'),
    Platform: {
      get isDesktopApp() {
        return isDesktopApp;
      },
    },
  };
});

jest.mock('./nodePtyInstallEnv', () => {
  return {
    getNodePtyPrebuiltOsArchForCurrentProcess: jest.fn(() => 'win32-x64'),
  };
});

type FakeFile = { path: string };

function createFakePlugin(params: {
  stewardFolder?: string;
  pluginVersion?: string;
  initialFiles?: Record<string, string>;
}): {
  plugin: jest.Mocked<StewardPlugin>;
  files: Map<string, string>;
} {
  const stewardFolder = params.stewardFolder ?? 'Steward';
  const pluginVersion = params.pluginVersion ?? '3.0.0';
  const files = new Map<string, string>(Object.entries(params.initialFiles ?? {}));

  const fileObjects = new Map<string, FakeFile>();
  const getOrCreateFileObject = (path: string): FakeFile => {
    const existing = fileObjects.get(path);
    if (existing) {
      return existing;
    }
    const f = { path };
    fileObjects.set(path, f);
    return f;
  };

  const mockVault = {
    getFileByPath: jest.fn((path: string) => {
      if (!files.has(path)) {
        return null;
      }
      return getOrCreateFileObject(path);
    }),
    read: jest.fn(async (file: FakeFile) => files.get(file.path) ?? ''),
    create: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
      return getOrCreateFileObject(path);
    }),
    modify: jest.fn(async (file: FakeFile, content: string) => {
      files.set(file.path, content);
    }),
    delete: jest.fn(async (file: FakeFile) => {
      files.delete(file.path);
      fileObjects.delete(file.path);
    }),
  };

  const mockFileManager = {
    renameFile: jest.fn(async (file: FakeFile, newPath: string) => {
      const content = files.get(file.path);
      files.delete(file.path);
      fileObjects.delete(file.path);
      if (content !== undefined) {
        files.set(newPath, content);
        file.path = newPath;
        fileObjects.set(newPath, file);
      }
    }),
  };

  const plugin = {
    settings: {
      stewardFolder,
    },
    manifest: {
      version: pluginVersion,
    },
    app: {
      vault: mockVault,
      fileManager: mockFileManager,
    },
  } as unknown as jest.Mocked<StewardPlugin>;

  return { plugin, files };
}

describe('NodePtyInstallerScriptService', () => {
  beforeEach(() => {
    isDesktopApp = true;
    jest.clearAllMocks();
  });

  describe('parseStewardInstallerMeta', () => {
    it('parses plugin-version and template from steward meta line', () => {
      const content = `#!/usr/bin/env bash
  # steward-installer-meta: plugin-version=2.6.0 template=1 prebuilt-pkg=0.13.1
  set -e
  `;
      expect(parseStewardInstallerMeta(content)).toEqual({
        pluginVersion: '2.6.0',
        templateVersion: '1',
      });
    });

    it('returns nulls when meta is missing', () => {
      expect(parseStewardInstallerMeta('# just a comment\n')).toEqual({
        pluginVersion: null,
        templateVersion: null,
      });
    });
  });

  describe('sync', () => {
    const shPath = `Steward/${NODE_PTY_INSTALLER_SH_BASENAME}`;
    const ps1Path = `Steward/${NODE_PTY_INSTALLER_PS1_BASENAME}`;
    const legacyShPath = 'Steward/install-node-pty-runtime-latest.sh';
    const legacyPs1Path = 'Steward/install-node-pty-runtime-latest.ps1';

    it('skips on mobile (non-desktop)', async () => {
      isDesktopApp = false;
      const { plugin } = createFakePlugin({});
      const service = new NodePtyInstallerScriptService(plugin);

      await service.sync();

      expect(plugin.app.vault.getFileByPath).not.toHaveBeenCalled();
      expect(plugin.app.vault.create).not.toHaveBeenCalled();
      expect(plugin.app.vault.modify).not.toHaveBeenCalled();
      expect(plugin.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('creates installer scripts when no script exists yet', async () => {
      const { plugin, files } = createFakePlugin({ pluginVersion: '3.0.0' });
      const service = new NodePtyInstallerScriptService(plugin);

      await service.sync();

      expect(plugin.app.vault.create).toHaveBeenCalledTimes(2);
      const created = files.get(shPath);
      expect(created).toEqual(expect.any(String));
      expect(created).toContain('# steward-installer-meta:');
      expect(created).toContain('plugin-version=3.0.0');
      expect(created).toContain('DEFAULT_OS_ARCH="${DEFAULT_OS_ARCH:-win32-x64}"');
      const createdPs1 = files.get(ps1Path);
      expect(createdPs1).toEqual(expect.any(String));
      expect(createdPs1).toContain('# steward-installer-meta:');
      expect(createdPs1).toContain('plugin-version=3.0.0');
      expect(createdPs1).toContain(
        "$DEFAULT_OS_ARCH = if ($null -ne $env:DEFAULT_OS_ARCH -and $env:DEFAULT_OS_ARCH -ne '') {"
      );
      expect(createdPs1).toContain("  'win32-x64'");
    });

    it('does nothing when installer script content is unchanged', async () => {
      const { plugin, files } = createFakePlugin({ pluginVersion: '3.0.0' });
      const service = new NodePtyInstallerScriptService(plugin);

      await service.sync();
      const firstBody = files.get(shPath);
      expect(firstBody).toEqual(expect.any(String));

      // Reset call counts and re-run with existing exact content
      (plugin.app.vault.create as jest.Mock).mockClear();
      (plugin.app.vault.modify as jest.Mock).mockClear();
      (plugin.app.fileManager.renameFile as jest.Mock).mockClear();

      await service.sync();

      expect(plugin.app.vault.create).not.toHaveBeenCalled();
      expect(plugin.app.vault.modify).not.toHaveBeenCalled();
      expect(plugin.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it('modifies installer script when content differs', async () => {
      const { plugin, files } = createFakePlugin({ pluginVersion: '3.0.0' });
      const service = new NodePtyInstallerScriptService(plugin);

      await service.sync();
      const firstBody = files.get(shPath);
      expect(firstBody).toEqual(expect.any(String));

      // Mutate on-disk content to diverge from the newly generated one
      files.set(shPath, `${firstBody}\n# extra\n`);

      (plugin.app.vault.create as jest.Mock).mockClear();
      (plugin.app.vault.modify as jest.Mock).mockClear();

      await service.sync();

      expect(plugin.app.vault.create).not.toHaveBeenCalled();
      expect(plugin.app.vault.modify).toHaveBeenCalledTimes(1);
      const shNow = files.get(shPath);
      expect(shNow).toBe(firstBody);
    });

    it('migrates legacy -latest installer filenames to canonical names', async () => {
      const oldBody = `#!/usr/bin/env bash
# steward-installer-meta: plugin-version=2.9.0 template=4 prebuilt-pkg=0.13.1 node=20 node-modules=115
echo "old"
`;
      const oldPs1 = `# steward-installer-meta: plugin-version=2.9.0 template=4 prebuilt-pkg=0.13.1 node=20 node-modules=115
`;

      const { plugin, files } = createFakePlugin({
        pluginVersion: '3.0.0',
        initialFiles: {
          [legacyShPath]: oldBody,
          [legacyPs1Path]: oldPs1,
        },
      });
      const service = new NodePtyInstallerScriptService(plugin);

      await service.sync();

      expect(plugin.app.fileManager.renameFile).toHaveBeenCalledTimes(2);
      expect(files.has(legacyShPath)).toBe(false);
      expect(files.has(legacyPs1Path)).toBe(false);
      const shNow = files.get(shPath);
      expect(shNow).toEqual(expect.any(String));
      expect(shNow).toContain('plugin-version=3.0.0');
    });

    it('updates installer in place when plugin version increases (no versioned rename)', async () => {
      const oldVersion = '2.9.0';
      const newVersion = '3.0.0';
      const oldShBody = `#!/usr/bin/env bash
# steward-installer-meta: plugin-version=${oldVersion} template=4 prebuilt-pkg=0.13.1 node=20 node-modules=115
echo "old"
`;

      const { plugin, files } = createFakePlugin({
        pluginVersion: newVersion,
        initialFiles: {
          [shPath]: oldShBody,
        },
      });
      const service = new NodePtyInstallerScriptService(plugin);

      await service.sync();

      expect(plugin.app.fileManager.renameFile).not.toHaveBeenCalled();
      expect(plugin.app.vault.modify).toHaveBeenCalled();
      const shNow = files.get(shPath);
      expect(shNow).toEqual(expect.any(String));
      expect(shNow).toContain('plugin-version=3.0.0');
      expect(shNow).not.toBe(oldShBody);
    });
  });
});
