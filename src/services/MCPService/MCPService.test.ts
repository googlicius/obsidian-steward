import { TFile } from 'obsidian';
import type { MCPClient } from '@ai-sdk/mcp';
import type StewardPlugin from 'src/main';
import i18next from 'src/i18n';
import { getInstance } from 'src/utils/getInstance';
import { getBundledLib } from 'src/utils/bundledLibs';
import { logger } from 'src/utils/logger';
import { NoteContentService } from 'src/services/NoteContentService';
import { MCPService } from './MCPService';

jest.mock('src/utils/bundledLibs', () => ({
  getBundledLib: jest.fn(),
}));

function createMockPlugin(): StewardPlugin {
  const plugin = {
    settings: { stewardFolder: 'Steward' },
    registerEvent: jest.fn(),
    app: {
      workspace: { onLayoutReady: jest.fn() },
      metadataCache: {
        on: jest.fn().mockReturnValue({}),
        getFileCache: jest.fn().mockReturnValue(null),
      },
      vault: {
        on: jest.fn().mockReturnValue({}),
        cachedRead: jest.fn(),
        getAbstractFileByPath: jest.fn(),
        getFolderByPath: jest.fn(),
      },
      fileManager: {
        processFrontMatter: jest.fn().mockResolvedValue(undefined),
      },
      secretStorage: {
        getSecret: jest.fn().mockReturnValue(null),
      },
    },
    conversationRenderer: {
      getConversationProperty: jest.fn(),
    },
    obsidianAPITools: {
      getFilesFromFolder: jest.fn().mockReturnValue([]),
    },
  } as unknown as StewardPlugin;
  const noteContentService = NoteContentService.getInstance(plugin);
  (plugin as unknown as { noteContentService: NoteContentService }).noteContentService =
    noteContentService;
  return plugin;
}

describe('MCPService', () => {
  let service: MCPService;
  let mockPlugin: StewardPlugin;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    MCPService.getInstance(mockPlugin);
    service = MCPService.getInstance();
  });

  describe('parseDefinition', () => {
    let parseDefinition: MCPService['parseDefinition'];

    beforeEach(() => {
      parseDefinition = service['parseDefinition'].bind(service);
    });

    it('parses valid frontmatter and JSON config', () => {
      const content = `---
name: My MCP
description: Test server
enabled: true
---
Some instructions.

\`\`\`json
{"transport":"http","url":"https://example.com/mcp"}
\`\`\`
`;
      const { definition, configValidationErrors } = parseDefinition({
        filePath: 'Steward/MCP/my-server.md',
        fileBasename: 'my-server',
        content,
      });
      expect(configValidationErrors).toEqual([]);
      expect(definition.name).toBe('My MCP');
      expect(definition.serverId).toBe('my_server');
      expect(definition.config).toEqual({
        transport: 'http',
        url: 'https://example.com/mcp',
      });
      expect(definition.enabled).toBe(true);
    });

    it('returns validation errors for invalid config schema', () => {
      const content = `---
name: Bad
---
\`\`\`json
{"transport":"websocket","url":""}
\`\`\`
`;
      const { definition, configValidationErrors } = parseDefinition({
        filePath: 'Steward/MCP/bad.md',
        fileBasename: 'bad',
        content,
      });
      expect(configValidationErrors.length).toBeGreaterThan(0);
      expect(definition.config).toBeNull();
      expect(definition.enabled).toBe(false);
    });

    it('returns error when JSON config block is missing', () => {
      const content = `---
name: Empty
---
No json here.
`;
      const { configValidationErrors } = parseDefinition({
        filePath: 'Steward/MCP/empty.md',
        fileBasename: 'empty',
        content,
      });
      expect(configValidationErrors).toContain(i18next.t('mcp.noConfigBlock'));
    });
  });

  describe('parseCachedToolNamesFromFrontmatter', () => {
    let parseCachedToolNamesFromFrontmatter: MCPService['parseCachedToolNamesFromFrontmatter'];

    beforeEach(() => {
      parseCachedToolNamesFromFrontmatter =
        service['parseCachedToolNamesFromFrontmatter'].bind(service);
    });

    it('returns an empty array for null and undefined', () => {
      expect(parseCachedToolNamesFromFrontmatter(null)).toEqual([]);
      expect(parseCachedToolNamesFromFrontmatter(undefined)).toEqual([]);
    });

    it('parses YAML-style string arrays', () => {
      expect(parseCachedToolNamesFromFrontmatter(['a', 'b'])).toEqual(['a', 'b']);
      expect(parseCachedToolNamesFromFrontmatter(['a', '', 'b'])).toEqual(['a', 'b']);
    });

    it('ignores non-string entries in YAML arrays', () => {
      expect(parseCachedToolNamesFromFrontmatter(['ok', 1, null, 'z'] as unknown[])).toEqual([
        'ok',
        'z',
      ]);
    });

    it('parses JSON array strings', () => {
      expect(parseCachedToolNamesFromFrontmatter('["echo","ping"]')).toEqual(['echo', 'ping']);
      expect(parseCachedToolNamesFromFrontmatter('  ["x"]  ')).toEqual(['x']);
      expect(parseCachedToolNamesFromFrontmatter('[]')).toEqual([]);
    });

    it('returns an empty array for placeholder or non-array JSON strings', () => {
      expect(parseCachedToolNamesFromFrontmatter('Check enabled to list tools')).toEqual([]);
      expect(parseCachedToolNamesFromFrontmatter('{}')).toEqual([]);
      expect(parseCachedToolNamesFromFrontmatter('["bad"')).toEqual([]);
    });

    it('returns an empty array for unsupported raw types', () => {
      expect(parseCachedToolNamesFromFrontmatter(42)).toEqual([]);
      expect(parseCachedToolNamesFromFrontmatter({ x: 1 })).toEqual([]);
    });
  });

  describe('refreshCachedToolNamesFromServer', () => {
    const mcpPath = 'Steward/MCP/refresh-test.md';

    it('returns early when definition is missing', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'refresh-test',
        extension: 'md',
      });
      await service['refreshCachedToolNamesFromServer'](file, mcpPath);
      expect(getBundledLib).not.toHaveBeenCalled();
      expect(mockPlugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
    });

    it('returns early when definition has no config', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'refresh-test',
        extension: 'md',
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'refresh_test',
        name: 'refresh',
        description: '',
        enabled: true,
        message: '',
        config: null,
        cachedToolNames: [],
        connectionMessage: '',
      });
      await service['refreshCachedToolNamesFromServer'](file, mcpPath);
      expect(getBundledLib).not.toHaveBeenCalled();
    });

    it('writes tools JSON and clears message on success', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'refresh-test',
        extension: 'md',
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'refresh_test',
        name: 'refresh',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://localhost' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      const mockClose = jest.fn().mockResolvedValue(undefined);
      const mockTools = jest.fn().mockResolvedValue({ a: {}, b: {} });
      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest.fn().mockResolvedValue({
          tools: mockTools,
          close: mockClose,
        }),
      });

      const fmUpdates: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fmUpdates);
          return Promise.resolve();
        });

      await service['refreshCachedToolNamesFromServer'](file, mcpPath);

      expect(getBundledLib).toHaveBeenCalledWith('mcp');
      expect(mockTools).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      const written = JSON.parse(fmUpdates.tools as string) as string[];
      expect(written.sort()).toEqual(['a', 'b']);
      expect(fmUpdates.message).toBeUndefined();
    });

    it('writes connection retry message on failure', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'refresh-test',
        extension: 'md',
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'refresh_test',
        name: 'refresh',
        description: '',
        enabled: true,
        message: '',
        config: {
          transport: 'http',
          url: 'http://localhost',
        },
        cachedToolNames: [],
        connectionMessage: '',
      });

      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest.fn().mockRejectedValue(new Error('econnrefused')),
      });

      const fmUpdates: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fmUpdates);
          return Promise.resolve();
        });

      await service['refreshCachedToolNamesFromServer'](file, mcpPath);

      expect(logger.warn).toHaveBeenCalledWith(
        `Failed to refresh MCP tool names for ${mcpPath}`,
        expect.any(Error)
      );
      expect(fmUpdates.message).toBe(i18next.t('mcp.connectionFailedRetry'));
    });

    it('skips when a refresh is already in flight for the same path', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'refresh-test',
        extension: 'md',
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'refresh_test',
        name: 'refresh',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://localhost' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      let releaseFirst: () => void = () => {};
      const firstGate = new Promise<void>(resolve => {
        releaseFirst = resolve;
      });

      const createMCPClient = jest.fn().mockImplementation(async () => {
        await firstGate;
        return {
          tools: jest.fn().mockResolvedValue({ x: {} }),
          close: jest.fn().mockResolvedValue(undefined),
        };
      });
      (getBundledLib as jest.Mock).mockResolvedValue({ createMCPClient });

      const p1 = service['refreshCachedToolNamesFromServer'](file, mcpPath);
      const p2 = service['refreshCachedToolNamesFromServer'](file, mcpPath);

      await Promise.resolve();
      expect(createMCPClient).toHaveBeenCalledTimes(1);

      releaseFirst();
      await Promise.all([p1, p2]);
      expect(createMCPClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleMetadataCacheChanged', () => {
    const mcpPath = 'Steward/MCP/meta-enabled.md';

    const mockRefreshCachedToolNames = (impl: jest.Mock): void => {
      const svc = service as unknown as {
        refreshCachedToolNamesFromServer: (f: TFile, p: string) => Promise<void>;
      };
      svc.refreshCachedToolNamesFromServer = impl as typeof svc.refreshCachedToolNamesFromServer;
    };

    it('does nothing when frontmatter enabled is not true', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'meta-enabled',
        extension: 'md',
      });
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { enabled: false },
      });
      const refreshMock = jest.fn().mockResolvedValue(undefined);
      mockRefreshCachedToolNames(refreshMock);

      await service['handleMetadataCacheChanged'](file);

      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('does nothing when tool names are already listed', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'meta-enabled',
        extension: 'md',
      });
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          enabled: true,
          status: i18next.t('common.statusValid'),
          tools: ['a'],
        },
      });
      const refreshMock = jest.fn().mockResolvedValue(undefined);
      mockRefreshCachedToolNames(refreshMock);

      await service['handleMetadataCacheChanged'](file);

      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('does nothing when there is no in-memory definition or config', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'meta-enabled',
        extension: 'md',
      });
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { enabled: true },
      });
      const refreshMock = jest.fn().mockResolvedValue(undefined);
      mockRefreshCachedToolNames(refreshMock);

      await service['handleMetadataCacheChanged'](file);

      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('does nothing when definition exists but config is null', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'meta-enabled',
        extension: 'md',
      });
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: { enabled: true, status: i18next.t('common.statusValid') },
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'meta_enabled',
        name: 'meta',
        description: '',
        enabled: true,
        message: '',
        config: null,
        cachedToolNames: [],
        connectionMessage: '',
      });
      const refreshMock = jest.fn().mockResolvedValue(undefined);
      mockRefreshCachedToolNames(refreshMock);

      await service['handleMetadataCacheChanged'](file);

      expect(refreshMock).not.toHaveBeenCalled();
    });

    it('calls refreshCachedToolNamesFromServer when enabled, tools empty, and config exists', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'meta-enabled',
        extension: 'md',
      });
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          enabled: true,
          status: i18next.t('common.statusValid'),
          tools: i18next.t('mcp.toolsPlaceholder'),
        },
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'meta_enabled',
        name: 'meta',
        description: '',
        enabled: false,
        message: '',
        config: { transport: 'http', url: 'http://localhost' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      const refreshMock = jest.fn().mockResolvedValue(undefined);
      mockRefreshCachedToolNames(refreshMock);

      await service['handleMetadataCacheChanged'](file);

      expect(refreshMock).toHaveBeenCalledWith(file, mcpPath);
    });

    it('does nothing when note status is not valid', async () => {
      const file = getInstance(TFile, {
        path: mcpPath,
        basename: 'meta-enabled',
        extension: 'md',
      });
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        frontmatter: {
          enabled: true,
          status: i18next.t('common.statusInvalid', { errors: 'bad config' }),
          tools: i18next.t('mcp.toolsPlaceholder'),
        },
      });
      service['definitionsByPath'].set(mcpPath, {
        path: mcpPath,
        serverId: 'meta_enabled',
        name: 'meta',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://localhost' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      const refreshMock = jest.fn().mockResolvedValue(undefined);
      mockRefreshCachedToolNames(refreshMock);

      await service['handleMetadataCacheChanged'](file);

      expect(refreshMock).not.toHaveBeenCalled();
    });
  });

  describe('getConversationActivatedToolNames', () => {
    it('returns a set of unique activated tool names from tools frontmatter', async () => {
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(['mcp__fetch__fetch', 'mcp__fetch__fetch', 'list']);

      const names = await service['getConversationActivatedToolNames']('My Chat');

      expect(Array.from(names)).toEqual(['mcp__fetch__fetch', 'list']);
      expect(mockPlugin.conversationRenderer.getConversationProperty).toHaveBeenCalledWith(
        'My Chat',
        'tools'
      );
    });

    it('returns empty set when tools frontmatter is missing or invalid', async () => {
      mockPlugin.conversationRenderer.getConversationProperty = jest.fn().mockResolvedValue(null);

      const names = await service['getConversationActivatedToolNames']('X');

      expect(Array.from(names)).toEqual([]);
    });
  });

  describe('ensureServerConnected', () => {
    it('returns null when definition is missing', async () => {
      const result = await service['ensureServerConnected']('Steward/MCP/ghost.md');
      expect(result).toBeNull();
    });

    it('creates client once and reuses cached connection', async () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      const mockTools = jest.fn().mockResolvedValue({ echo: { execute: jest.fn() } });
      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest.fn().mockResolvedValue({
          tools: mockTools,
          close: mockClose,
        }),
      });

      const path = 'Steward/MCP/live.md';
      service['definitionsByPath'].set(path, {
        path,
        serverId: 'x',
        name: 'live',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://localhost' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      const first = await service['ensureServerConnected'](path);
      const second = await service['ensureServerConnected'](path);

      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(getBundledLib).toHaveBeenCalledWith('mcp');
      expect(mockTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadDefinitionFromFile', () => {
    it('sets enabled: false and tools placeholder when keys are missing', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/MCP/no-enabled-key.md',
        basename: 'no-enabled-key',
        extension: 'md',
      });
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(`---
name: No Enabled Key
---
\`\`\`json
{"transport":"http","url":"http://localhost"}
\`\`\`
`);
      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await service['loadDefinitionFromFile'](file);

      expect(fm.enabled).toBe(false);
      expect(fm.tools).toBe(i18next.t('mcp.toolsPlaceholder'));
      expect(mockPlugin.app.fileManager.processFrontMatter).toHaveBeenCalled();
    });

    it('skips loading if the vault read throws', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/MCP/unreadable.md',
        basename: 'unreadable',
        extension: 'md',
      });
      const readError = new Error('read failed');
      mockPlugin.app.vault.cachedRead = jest.fn().mockRejectedValue(readError);

      service['definitionsByPath'].set('Steward/MCP/unreadable.md', {
        path: 'Steward/MCP/unreadable.md',
        serverId: 'stale',
        name: 'stale',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://x' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      await service['loadDefinitionFromFile'](file);

      expect(service['definitionsByPath'].has('Steward/MCP/unreadable.md')).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to read MCP definition file Steward/MCP/unreadable.md',
        readError
      );
    });

    it('stores parsed definition in definitionsByPath', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/MCP/loadme.md',
        basename: 'loadme',
        extension: 'md',
      });
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(`---
name: Loaded
enabled: true
tools:
  - x
---
\`\`\`json
{"transport":"http","url":"http://localhost"}
\`\`\`
`);
      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await service['loadDefinitionFromFile'](file);

      const def = service['definitionsByPath'].get('Steward/MCP/loadme.md');
      expect(def?.name).toBe('Loaded');
      expect(def?.config?.url).toBe('http://localhost');
      expect(def?.enabled).toBe(true);
      expect(def?.cachedToolNames).toEqual(['x']);
      expect(fm.status).toBe(i18next.t('common.statusValid'));
    });

    it('updates note frontmatter status when MCP config JSON is invalid', async () => {
      const file = getInstance(TFile, {
        path: 'Steward/MCP/broken.md',
        basename: 'broken',
        extension: 'md',
      });
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(`---
name: Broken
---
\`\`\`json
not json
\`\`\`
`);
      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await service['loadDefinitionFromFile'](file);

      expect(mockPlugin.app.fileManager.processFrontMatter).toHaveBeenCalled();
      expect(fm.enabled).toBe(false);
      expect(fm.tools).toBe(i18next.t('mcp.toolsPlaceholder'));
      expect(fm.status).not.toBe(i18next.t('common.statusValid'));
      expect(String(fm.status)).not.toBe('');
    });
  });

  describe('expandSecretPlaceholders', () => {
    let expandSecretPlaceholders: MCPService['expandSecretPlaceholders'];

    beforeEach(() => {
      expandSecretPlaceholders = service['expandSecretPlaceholders'].bind(service);
    });

    it('replaces $secret:key with the value from secretStorage', () => {
      mockPlugin.app.secretStorage.getSecret = jest
        .fn()
        .mockImplementation((name: string) => (name === 'api_token' ? 'secret-value' : null));

      const input = {
        url: 'https://example.com',
        headers: { Authorization: 'Bearer $secret:api_token' },
      };
      const out = expandSecretPlaceholders(input) as Record<string, unknown>;
      const headers = out.headers as Record<string, unknown>;
      expect(headers.Authorization).toBe('Bearer secret-value');
    });

    it('leaves the placeholder intact and logs a warning when the secret is not found', () => {
      mockPlugin.app.secretStorage.getSecret = jest.fn().mockReturnValue(null);

      const out = expandSecretPlaceholders('$secret:missing') as string;

      expect(out).toBe('$secret:missing');
      expect(logger.warn).toHaveBeenCalledWith('MCP secret not found for placeholder: missing');
    });

    it('recursively expands secrets in nested objects and arrays', () => {
      mockPlugin.app.secretStorage.getSecret = jest.fn().mockImplementation((name: string) => {
        if (name === 'a') {
          return 'va';
        }
        if (name === 'b') {
          return 'vb';
        }
        return null;
      });

      const input = {
        nested: { x: ['before $secret:a after', { y: '$secret:b' }] },
      };
      const out = expandSecretPlaceholders(input) as Record<string, unknown>;
      const nested = out.nested as Record<string, unknown>;
      const arr = nested.x as unknown[];
      expect(arr[0]).toBe('before va after');
      const inner = arr[1] as Record<string, unknown>;
      expect(inner.y).toBe('vb');
    });

    it('does not modify non-string leaf values', () => {
      const input = { n: 42, b: false, z: null, s: 'keep' };
      const out = expandSecretPlaceholders(input) as Record<string, unknown>;
      expect(out.n).toBe(42);
      expect(out.b).toBe(false);
      expect(out.z).toBeNull();
      expect(out.s).toBe('keep');
    });
  });

  describe('getMcpToolsForConversation', () => {
    it('places listed tools in active and the rest in inactive', async () => {
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(['mcp__srv_a__echo']);

      const pathA = 'Steward/MCP/srv-a.md';
      const pathB = 'Steward/MCP/srv-b.md';
      service['definitionsByPath'].set(pathA, {
        path: pathA,
        serverId: 'srv_a',
        name: 'A',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://a' },
        cachedToolNames: [],
        connectionMessage: '',
      });
      service['definitionsByPath'].set(pathB, {
        path: pathB,
        serverId: 'srv_b',
        name: 'B',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://b' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      const echoTool = { execute: jest.fn() };
      const pingTool = { execute: jest.fn() };
      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest
          .fn()
          .mockImplementation(async ({ transport }: { transport: { url: string } }) => ({
            tools: jest.fn().mockImplementation(async () => {
              if (transport.url === 'http://a') {
                return { echo: echoTool };
              }
              if (transport.url === 'http://b') {
                return { ping: pingTool };
              }
              return {};
            }),
            close: jest.fn().mockResolvedValue(undefined),
          })),
      });

      const { active, inactive } = await service.getMcpToolsForConversation('Chat 1');

      expect(active).toEqual({ mcp__srv_a__echo: echoTool });
      expect(inactive).toEqual({ mcp__srv_b__ping: pingTool });
    });

    it('skips definitions that are disabled or have no config', async () => {
      mockPlugin.conversationRenderer.getConversationProperty = jest.fn().mockResolvedValue([]);

      const okPath = 'Steward/MCP/ok.md';
      const disabledPath = 'Steward/MCP/off.md';
      const noConfigPath = 'Steward/MCP/nocfg.md';

      service['definitionsByPath'].set(okPath, {
        path: okPath,
        serverId: 'ok',
        name: 'ok',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://ok' },
        cachedToolNames: [],
        connectionMessage: '',
      });
      service['definitionsByPath'].set(disabledPath, {
        path: disabledPath,
        serverId: 'off',
        name: 'off',
        description: '',
        enabled: false,
        message: '',
        config: { transport: 'http', url: 'http://off' },
        cachedToolNames: [],
        connectionMessage: '',
      });
      service['definitionsByPath'].set(noConfigPath, {
        path: noConfigPath,
        serverId: 'nocfg',
        name: 'nocfg',
        description: '',
        enabled: true,
        message: '',
        config: null,
        cachedToolNames: [],
        connectionMessage: '',
      });

      const onlyTool = { execute: jest.fn() };
      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest.fn().mockResolvedValue({
          tools: jest.fn().mockResolvedValue({ t: onlyTool }),
          close: jest.fn().mockResolvedValue(undefined),
        }),
      });

      const { active, inactive } = await service.getMcpToolsForConversation('X');

      expect(getBundledLib).toHaveBeenCalledTimes(1);
      expect(active).toEqual({});
      expect(inactive).toEqual({ mcp__ok__t: onlyTool });
    });

    it('skips definitions where server connection fails', async () => {
      mockPlugin.conversationRenderer.getConversationProperty = jest.fn().mockResolvedValue([]);

      const okPath = 'Steward/MCP/good.md';
      const badPath = 'Steward/MCP/bad-conn.md';

      service['definitionsByPath'].set(okPath, {
        path: okPath,
        serverId: 'good',
        name: 'good',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://good' },
        cachedToolNames: [],
        connectionMessage: '',
      });
      service['definitionsByPath'].set(badPath, {
        path: badPath,
        serverId: 'bad',
        name: 'bad',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://bad' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      const goodTool = { execute: jest.fn() };
      const createMCPClient = jest
        .fn()
        .mockImplementation(async ({ transport }: { transport: { url: string } }) => {
          if (transport.url === 'http://bad') {
            throw new Error('connection refused');
          }
          return {
            tools: jest.fn().mockResolvedValue({ u: goodTool }),
            close: jest.fn().mockResolvedValue(undefined),
          };
        });
      (getBundledLib as jest.Mock).mockResolvedValue({ createMCPClient });

      const { inactive } = await service.getMcpToolsForConversation('Y');

      expect(inactive).toEqual({ mcp__good__u: goodTool });
      expect(Object.keys(inactive)).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to connect MCP server for Steward/MCP/bad-conn.md',
        expect.any(Error)
      );

      await service.getMcpToolsForConversation('Y');
      expect(createMCPClient).toHaveBeenCalledTimes(2);
    });

    it('uses name-only stub tools when connection fails but cached tool names exist', async () => {
      mockPlugin.conversationRenderer.getConversationProperty = jest.fn().mockResolvedValue([]);

      const badPath = 'Steward/MCP/bad-stub.md';
      service['definitionsByPath'].set(badPath, {
        path: badPath,
        serverId: 'bad_stub',
        name: 'bad stub',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://bad' },
        cachedToolNames: ['echo'],
        connectionMessage: 'offline',
      });

      (getBundledLib as jest.Mock).mockImplementation(async (lib: string) => {
        if (lib === 'mcp') {
          return {
            createMCPClient: jest.fn().mockRejectedValue(new Error('connection refused')),
          };
        }
        return {};
      });

      const offlineMsg = 'This MCP tool is unavailable because the server is not connected';

      const { inactive } = await service.getMcpToolsForConversation('Z');

      const key = 'mcp__bad_stub__echo';
      expect(inactive[key]).toBeDefined();
      const stub = inactive[key] as {
        description?: string;
        execute: (input: unknown, ctx: unknown) => Promise<unknown>;
        inputSchema?: unknown;
      };
      expect(stub.description).toBe(offlineMsg);
      expect(stub.inputSchema).toBeUndefined();
      await expect(stub.execute({}, { messages: [], toolCallId: '1' })).resolves.toBe(offlineMsg);
    });
  });

  describe('removeDefinitionByPath', () => {
    it('closes the MCP client and removes cached connection', async () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      const path = 'Steward/MCP/gone.md';
      service['connectionCacheByPath'].set(path, {
        kind: 'connected',
        server: {
          definitionPath: path,
          client: { close: mockClose } as unknown as MCPClient,
          tools: {},
        },
      });
      service['definitionsByPath'].set(path, {
        path,
        serverId: 'gone',
        name: 'gone',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://x' },
        cachedToolNames: [],
        connectionMessage: '',
      });

      service['removeDefinitionByPath'](path);

      await Promise.resolve();
      expect(mockClose).toHaveBeenCalled();
      expect(service['connectionCacheByPath'].has(path)).toBe(false);
      expect(service['definitionsByPath'].has(path)).toBe(false);
    });
  });

  describe('getAllDefinitions', () => {
    it('returns definitions sorted by name then path', () => {
      service['definitionsByPath'].clear();
      service['definitionsByPath'].set('Steward/MCP/b.md', {
        path: 'Steward/MCP/b.md',
        serverId: 'b',
        name: 'Beta',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://b' },
        cachedToolNames: [],
        connectionMessage: '',
      });
      service['definitionsByPath'].set('Steward/MCP/a.md', {
        path: 'Steward/MCP/a.md',
        serverId: 'a',
        name: 'Alpha',
        description: '',
        enabled: false,
        message: '',
        config: null,
        cachedToolNames: [],
        connectionMessage: '',
      });

      const all = service.getAllDefinitions();

      expect(all.map(d => d.serverId)).toEqual(['a', 'b']);
    });
  });
});
