import { TAbstractFile, TFile, TFolder, parseYaml } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import { WidgetService } from './WidgetService';

type FakeFile = { path: string };

function buildMarkdownSections(content: string) {
  const lines = content.split('\n');
  const sections: Array<{
    type: string;
    position: {
      start: { line: number; col: number; offset: number };
      end: { line: number; col: number; offset: number };
    };
  }> = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (line.match(/^```/)) {
      let endLine = lineIndex;
      for (let i = lineIndex + 1; i < lines.length; i++) {
        if (lines[i].match(/^```/)) {
          endLine = i;
          break;
        }
      }
      sections.push({
        type: 'code',
        position: {
          start: { line: lineIndex, col: 0, offset: 0 },
          end: { line: endLine, col: lines[endLine].length, offset: 0 },
        },
      });
      lineIndex = endLine + 1;
      continue;
    }

    lineIndex++;
  }

  return sections;
}

function parseWidgetMdManifest(content: string): Record<string, unknown> {
  const match = content.match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error('Widget.md manifest fence not found');
  }
  const parsed = parseYaml(match[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid manifest YAML');
  }
  return parsed as Record<string, unknown>;
}

function withMarkdownDefinitionService(
  plugin: jest.Mocked<StewardPlugin>
): jest.Mocked<StewardPlugin> {
  (MarkdownDefinitionService as unknown as { instance?: MarkdownDefinitionService }).instance =
    undefined;
  return {
    ...plugin,
    markdownDefinitionService: MarkdownDefinitionService.getInstance(plugin),
  } as jest.Mocked<StewardPlugin>;
}

function createProjectTestPlugin(params?: { initialFiles?: Record<string, string> }): {
  plugin: jest.Mocked<StewardPlugin>;
  files: Map<string, string>;
} {
  const files = new Map<string, string>(Object.entries(params?.initialFiles ?? {}));
  const fileObjects = new Map<string, FakeFile>();

  const getOrCreateFileObject = (path: string): FakeFile => {
    const existing = fileObjects.get(path);
    if (existing) {
      return existing;
    }
    const file = { path };
    fileObjects.set(path, file);
    return file;
  };

  const plugin = {
    settings: { stewardFolder: 'Steward' },
    app: {
      vault: {
        getFolderByPath: jest.fn(),
        getFileByPath: jest.fn((path: string) => {
          if (!files.has(path)) {
            return null;
          }
          return getOrCreateFileObject(path);
        }),
        read: jest.fn(async (file: FakeFile) => files.get(file.path) ?? ''),
        modify: jest.fn(async (file: FakeFile, content: string) => {
          files.set(file.path, content);
        }),
        create: jest.fn(async (path: string, content: string) => {
          files.set(path, content);
          return getOrCreateFileObject(path);
        }),
      },
      metadataCache: {
        getFileCache: jest.fn((file: TFile) => {
          const content = files.get(file.path);
          if (!content) {
            return null;
          }
          return { sections: buildMarkdownSections(content) };
        }),
      },
    },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
      getFilesFromFolder: jest.fn(),
    },
    registerEvent: jest.fn(),
    mediaTools: {
      findFileByNameOrPath: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;

  return { plugin: withMarkdownDefinitionService(plugin), files };
}

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const indexFile = getInstance(TFile, {
    path: 'Steward/Widgets/Tic-Tac-Toe-abc12/index.html',
    name: 'index.html',
  });
  const definitionFile = getInstance(TFile, {
    path: 'Steward/Widgets/Tic-Tac-Toe-abc12/Widget.md',
    name: 'Widget.md',
  });
  const projectFolder = getInstance(TFolder, {
    path: 'Steward/Widgets/Tic-Tac-Toe-abc12',
    children: [indexFile, definitionFile],
  });

  const plugin = {
    settings: { stewardFolder: 'Steward' },
    app: {
      vault: {
        getFolderByPath: jest.fn((path: string) => {
          if (path === 'Steward/Widgets/Tic-Tac-Toe-abc12') {
            return projectFolder;
          }
          return null;
        }),
        getFileByPath: jest.fn(),
        read: jest.fn(),
        modify: jest.fn(),
        create: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn(),
      },
    },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
      getFilesFromFolder: jest.fn().mockReturnValue([indexFile, definitionFile]),
    },
    registerEvent: jest.fn(),
    mediaTools: {
      findFileByNameOrPath: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;

  return withMarkdownDefinitionService(plugin);
}

describe('WidgetService', () => {
  beforeEach(() => {
    (WidgetService as unknown as { instance?: WidgetService }).instance = undefined;
    (MarkdownDefinitionService as unknown as { instance?: MarkdownDefinitionService }).instance =
      undefined;
  });

  describe('parseProjectFenceContent', () => {
    it('parses widgetId and projectPath from code block textContent', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const body = `widgetId: Tic-Tac-Toe-abc12
projectPath: Steward/Widgets/Tic-Tac-Toe-abc12
`;

      const parsed = service.parseProjectFenceContent(body);

      expect(parsed).toEqual({
        widgetId: 'Tic-Tac-Toe-abc12',
        projectPath: 'Steward/Widgets/Tic-Tac-Toe-abc12',
      });
    });

    it('parses when widgetId and projectPath appear inside a larger message', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const content = `Some text\nwidgetId: Tic-Tac-Toe-abc12\nprojectPath: Steward/Widgets/Tic-Tac-Toe-abc12\nmore`;

      const parsed = service.parseProjectFenceContent(content);

      expect(parsed).toEqual({
        widgetId: 'Tic-Tac-Toe-abc12',
        projectPath: 'Steward/Widgets/Tic-Tac-Toe-abc12',
      });
    });
  });

  describe('buildWidgetId', () => {
    it('slugifies whitespace and appends a unique suffix', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const id = service.buildWidgetId('Tic Tac Toe');
      expect(id.startsWith('Tic-Tac-Toe')).toBe(true);
      expect(id.length).toBeGreaterThan('Tic-Tac-Toe'.length);
    });

    it('throws when widget name is empty after trimming', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      expect(() => service.buildWidgetId('   ')).toThrow('Widget name must not be empty');
    });
  });

  describe('slugifyWidgetName', () => {
    it('replaces whitespace with dashes and strips invalid path characters', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      expect(service.slugifyWidgetName('My Counter')).toBe('My-Counter');
      expect(service.slugifyWidgetName('bad/name')).toBe('badname');
    });
  });

  describe('buildProjectFence', () => {
    it('includes widgetId in a small tag below the fence', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const fence = service.buildProjectFence({
        widgetId: 'Tic-Tac-Toe-abc12',
        projectPath: 'Steward/Widgets/Tic-Tac-Toe-abc12',
      });

      expect(fence).toContain('```stw-widget-project');
      expect(fence).toContain('<small>*ID: Tic-Tac-Toe-abc12*</small>');
    });
  });

  describe('getProjectPath', () => {
    it('builds the project folder directly under the widgets root', () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const path = service.getProjectPath({
        widgetId: 'Tic-Tac-Toe-abc12',
      });

      expect(path).toBe('Steward/Widgets/Tic-Tac-Toe-abc12');
    });
  });

  describe('listProjectFiles', () => {
    it('returns relative paths via obsidianAPITools.getFilesFromFolder', async () => {
      const plugin = createMockPlugin();
      const service = WidgetService.getInstance(plugin);

      const files = await service.listProjectFiles('Steward/Widgets/Tic-Tac-Toe-abc12');

      expect(plugin.obsidianAPITools.getFilesFromFolder).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'Steward/Widgets/Tic-Tac-Toe-abc12' }),
        { recursive: true }
      );
      expect(files).toEqual(['Widget.md', 'index.html']);
    });
  });

  describe('createProject', () => {
    const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';
    const widgetName = 'Tic Tac Toe';

    it('creates project folder, files, and Widget.md manifest for a new project', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      const result = await service.createProject({
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        files: {
          'index.html': '<p>Hello</p>',
        },
      });

      expect(result).toEqual({ projectPath, entry: 'index.html' });
      expect(plugin.obsidianAPITools.ensureFolderExists).toHaveBeenCalledWith(projectPath);
      expect(plugin.app.vault.create).toHaveBeenCalledWith(
        `${projectPath}/index.html`,
        '<p>Hello</p>'
      );
      expect(files.get(`${projectPath}/index.html`)).toBe('<p>Hello</p>');
      expect(parseWidgetMdManifest(files.get(`${projectPath}/Widget.md`) ?? '')).toEqual({
        name: 'manifest',
        entry: 'index.html',
        type: 'html',
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
      });
    });

    it('uses a custom entry file when provided', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      const result = await service.createProject({
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        entry: 'app.html',
        files: {
          'app.html': '<p>App</p>',
        },
      });

      expect(result).toEqual({ projectPath, entry: 'app.html' });
      expect(plugin.app.vault.create).toHaveBeenCalledWith(`${projectPath}/app.html`, '<p>App</p>');
      expect(parseWidgetMdManifest(files.get(`${projectPath}/Widget.md`) ?? '')).toEqual({
        name: 'manifest',
        entry: 'app.html',
        type: 'html',
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
      });
    });

    it('throws when the entry file is missing from files', async () => {
      const { plugin } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      await expect(
        service.createProject({
          widgetId: 'Tic-Tac-Toe-abc12',
          widgetName,
          entry: 'app.html',
          files: {
            'index.html': '<p>Wrong entry</p>',
          },
        })
      ).rejects.toThrow('Widget entry file "app.html" is missing from files');

      expect(plugin.app.vault.create).not.toHaveBeenCalled();
    });

    it('throws when a file path escapes the project directory', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      await expect(
        service.createProject({
          widgetId: 'Tic-Tac-Toe-abc12',
          widgetName,
          files: {
            '../escape.html': '<p>Bad</p>',
            'index.html': '<p>Hello</p>',
          },
        })
      ).rejects.toThrow('Invalid widget file path: ../escape.html');

      expect(plugin.app.vault.create).not.toHaveBeenCalled();
      expect(files.size).toBe(0);
    });

    it('modifies existing project files instead of creating them', async () => {
      const { plugin, files } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/index.html`]: '<p>Old</p>',
          [`${projectPath}/Widget.md`]:
            '```yaml\nname: manifest\nentry: index.html\ntype: html\n```',
        },
      });
      const service = WidgetService.getInstance(plugin);

      await service.createProject({
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        files: {
          'index.html': '<p>Updated</p>',
        },
      });

      expect(plugin.app.vault.modify).toHaveBeenCalledWith(
        expect.objectContaining({ path: `${projectPath}/index.html` }),
        '<p>Updated</p>'
      );
      expect(plugin.app.vault.create).not.toHaveBeenCalled();
      expect(files.get(`${projectPath}/index.html`)).toBe('<p>Updated</p>');
    });

    it('creates parent folders for nested file paths', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      await service.createProject({
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        files: {
          'index.html': '<p>Hello</p>',
          'styles/theme.css': 'body { color: red; }',
        },
      });

      expect(plugin.obsidianAPITools.ensureFolderExists).toHaveBeenCalledWith(
        `${projectPath}/styles`
      );
      expect(files.get(`${projectPath}/styles/theme.css`)).toBe('body { color: red; }');
    });

    it('includes normalized assets in manifest when provided', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      await service.createProject({
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        files: {
          'index.html': '<img src="asset:Images/logo.png" />',
        },
        assets: ['asset:Images/logo.png', 'Docs/bg.png'],
      });

      expect(parseWidgetMdManifest(files.get(`${projectPath}/Widget.md`) ?? '')).toEqual({
        name: 'manifest',
        entry: 'index.html',
        type: 'html',
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        assets: ['Images/logo.png', 'Docs/bg.png'],
      });
    });

    it('omits assets from manifest when none are provided', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      await service.createProject({
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
        files: {
          'index.html': '<p>No assets</p>',
        },
      });

      const manifest = parseWidgetMdManifest(files.get(`${projectPath}/Widget.md`) ?? '');
      expect(manifest).toEqual({
        name: 'manifest',
        entry: 'index.html',
        type: 'html',
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName,
      });
      expect(manifest.assets).toBeUndefined();
    });
  });

  describe('readManifest', () => {
    const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';

    it('returns the validated manifest schema data', async () => {
      const widgetMd = [
        '```yaml',
        'name: manifest',
        'entry: index.html',
        'type: html',
        'widgetId: Tic-Tac-Toe-abc12',
        'widgetName: Tic Tac Toe',
        '```',
      ].join('\n');
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: widgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);

      const manifest = await service.readManifest(projectPath);

      expect(manifest).toEqual({
        name: 'manifest',
        entry: 'index.html',
        type: 'html',
        widgetId: 'Tic-Tac-Toe-abc12',
        widgetName: 'Tic Tac Toe',
      });
    });

    it('returns null when Widget.md is missing', async () => {
      const { plugin } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      expect(await service.readManifest(projectPath)).toBeNull();
    });
  });

  describe('readActions and applyAction', () => {
    const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';

    const actionsWidgetMd = [
      '```yaml',
      'name: manifest',
      'entry: index.html',
      'type: html',
      '```',
      '',
      '```yaml',
      'name: actions',
      'actions:',
      '  playCell:',
      '    description: Place mark for current player',
      '    params:',
      '      index:',
      '        type: integer',
      '        minimum: 0',
      '        maximum: 8',
      '```',
    ].join('\n');

    it('reads the actions catalog from Widget.md', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: actionsWidgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);

      const catalog = await service.readActions(projectPath);

      expect(catalog?.actions.playCell?.params?.index).toEqual({
        type: 'integer',
        minimum: 0,
        maximum: 8,
      });
    });

    it('returns actions_catalog_missing when Widget.md has no actions block', async () => {
      const { plugin } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      const result = await service.applyAction({
        projectPath,
        action: 'playCell',
        actionParams: { index: 1 },
      });

      expect(result).toEqual({ ok: false, error: 'actions_catalog_missing' });
    });

    it('returns widget_not_mounted when no iframe bridge is registered', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: actionsWidgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);

      const result = await service.applyAction({
        projectPath,
        action: 'playCell',
        actionParams: { index: 1 },
      });

      expect(result).toEqual({ ok: false, error: 'widget_not_mounted' });
    });

    it('dispatches validated actions through the mounted iframe bridge', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: actionsWidgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);
      let capturedRequestId = '';

      const unregister = service.registerActionBridge({
        projectPath,
        sendApplyAction: payload => {
          capturedRequestId = payload.requestId;
          service.setRegisteredActions(projectPath, ['playCell']);
          service.resolveActionResult({
            requestId: payload.requestId,
            ok: true,
            state: { cells: Array(9).fill(null) },
          });
        },
      });

      const result = await service.applyAction({
        projectPath,
        action: 'playCell',
        actionParams: { index: 4 },
      });

      unregister();
      expect(capturedRequestId).toMatch(/^stw-action-/);
      expect(result.ok).toBe(true);
    });

    it('rejects invalid action params before dispatch', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: actionsWidgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);

      const unregister = service.registerActionBridge({
        projectPath,
        sendApplyAction: () => {
          throw new Error('should not dispatch');
        },
      });

      const result = await service.applyAction({
        projectPath,
        action: 'playCell',
        actionParams: { index: 99 },
      });

      unregister();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('<= 8');
    });

    it('rejects unknown actions before dispatch', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: actionsWidgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);

      const result = await service.applyAction({
        projectPath,
        action: 'resetGame',
        actionParams: {},
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown action');
    });

    it('rejects missing required params before dispatch', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/Widget.md`]: actionsWidgetMd,
        },
      });
      const service = WidgetService.getInstance(plugin);

      const result = await service.applyAction({
        projectPath,
        action: 'playCell',
        actionParams: {},
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing required param "index"');
    });
  });

  describe('readState and writeState', () => {
    const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';

    it('returns null when state.json has an invalid envelope', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/state.json`]: JSON.stringify({
            version: 99,
            updatedAt: '2026-01-01T00:00:00.000Z',
          }),
        },
      });
      const service = WidgetService.getInstance(plugin);

      const state = await service.readState(projectPath);

      expect(state).toBeNull();
    });

    it('returns null when state.json does not exist', async () => {
      const { plugin } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      const state = await service.readState(projectPath);

      expect(state).toBeNull();
    });

    it('round-trips widget data through state.json with envelope fields', async () => {
      const { plugin, files } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);
      const payload = { cells: [null, 'x', null], turn: 'o' };

      await service.writeState({ projectPath, data: payload });

      const statePath = `${projectPath}/state.json`;
      expect(files.has(statePath)).toBe(true);

      const stored = JSON.parse(files.get(statePath) ?? '');
      expect(stored.version).toBe(1);
      expect(typeof stored.updatedAt).toBe('string');
      expect(stored.data).toEqual(payload);

      const read = await service.readState(projectPath);
      expect(read?.data).toEqual(payload);
    });

    it('updates existing state.json on subsequent writes', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/state.json`]: JSON.stringify({
            version: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            data: { count: 1 },
          }),
        },
      });
      const service = WidgetService.getInstance(plugin);

      await service.writeState({ projectPath, data: { count: 2 } });

      const read = await service.readState(projectPath);
      expect(read?.data).toEqual({ count: 2 });
      expect(plugin.app.vault.modify).toHaveBeenCalled();
      expect(plugin.app.vault.create).not.toHaveBeenCalled();
    });
  });

  describe('buildStateHead', () => {
    it('delegates to buildWidgetStateHead', () => {
      const { plugin } = createProjectTestPlugin();
      const service = WidgetService.getInstance(plugin);

      const head = service.buildStateHead({
        version: 1,
        updatedAt: '2026-05-29T00:00:00.000Z',
        data: { score: 3 },
      });

      expect(head).toContain('"score":3');
      expect(head).toContain('window.stw');
    });
  });

  describe('modify listener hot-reload', () => {
    const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';

    it('skips refresh when only state.json changes', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/index.html`]: '<p>Hi</p>',
          [`${projectPath}/Widget.md`]:
            '```yaml\nname: manifest\nentry: index.html\ntype: html\n```',
        },
      });

      let modifyHandler: ((file: TAbstractFile) => void) | undefined;
      plugin.app.vault.on = jest.fn((event: string, handler: (file: TAbstractFile) => void) => {
        if (event === 'modify') {
          modifyHandler = handler;
        }
        return {} as ReturnType<typeof plugin.app.vault.on>;
      });

      const service = WidgetService.getInstance(plugin);
      const refresh = jest.fn().mockResolvedValue(undefined);

      service.registerMountedWidget({
        container: {} as HTMLElement,
        projectPath,
        refresh,
      });

      expect(modifyHandler).toBeDefined();

      const stateFile = getInstance(TFile, {
        path: `${projectPath}/state.json`,
        name: 'state.json',
      });
      modifyHandler?.(stateFile);

      expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes when a non-state project file changes', async () => {
      const { plugin } = createProjectTestPlugin({
        initialFiles: {
          [`${projectPath}/index.html`]: '<p>Hi</p>',
          [`${projectPath}/Widget.md`]:
            '```yaml\nname: manifest\nentry: index.html\ntype: html\n```',
        },
      });

      let modifyHandler: ((file: TAbstractFile) => void) | undefined;
      plugin.app.vault.on = jest.fn((event: string, handler: (file: TAbstractFile) => void) => {
        if (event === 'modify') {
          modifyHandler = handler;
        }
        return {} as ReturnType<typeof plugin.app.vault.on>;
      });

      const service = WidgetService.getInstance(plugin);
      const refresh = jest.fn().mockResolvedValue(undefined);

      service.registerMountedWidget({
        container: {} as HTMLElement,
        projectPath,
        refresh,
      });

      const indexFile = getInstance(TFile, {
        path: `${projectPath}/index.html`,
        name: 'index.html',
      });
      modifyHandler?.(indexFile);

      expect(refresh).toHaveBeenCalled();
    });
  });
});
