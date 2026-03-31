import { TFile } from 'obsidian';
import type { MCPClient } from '@ai-sdk/mcp';
import type StewardPlugin from 'src/main';
import i18next from 'src/i18n';
import { getInstance } from 'src/utils/getInstance';
import { getBundledLib } from 'src/utils/bundledLibs';
import { logger } from 'src/utils/logger';
import { MCPService } from './MCPService';

jest.mock('src/utils/bundledLibs', () => ({
  getBundledLib: jest.fn(),
}));

function createMockPlugin(): StewardPlugin {
  return {
    settings: { stewardFolder: 'Steward' },
    registerEvent: jest.fn(),
    app: {
      workspace: { onLayoutReady: jest.fn() },
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
        enabled: true,
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
        config: { transport: 'http', url: 'http://localhost', enabled: true },
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
    it('sets enabled: true in frontmatter when the enabled key is missing', async () => {
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

      expect(fm.enabled).toBe(true);
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
        config: { transport: 'http', url: 'http://x', enabled: true },
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
      expect(fm.enabled).toBe(true);
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
      expect(fm.enabled).toBe(true);
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
        config: { transport: 'http', url: 'http://a', enabled: true },
      });
      service['definitionsByPath'].set(pathB, {
        path: pathB,
        serverId: 'srv_b',
        name: 'B',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://b', enabled: true },
      });

      const echoTool = { execute: jest.fn() };
      const pingTool = { execute: jest.fn() };
      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest.fn().mockImplementation(async ({ transport }: { transport: { url: string } }) => ({
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

      expect(active).toEqual({ 'mcp__srv_a__echo': echoTool });
      expect(inactive).toEqual({ 'mcp__srv_b__ping': pingTool });
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
        config: { transport: 'http', url: 'http://ok', enabled: true },
      });
      service['definitionsByPath'].set(disabledPath, {
        path: disabledPath,
        serverId: 'off',
        name: 'off',
        description: '',
        enabled: false,
        message: '',
        config: { transport: 'http', url: 'http://off', enabled: true },
      });
      service['definitionsByPath'].set(noConfigPath, {
        path: noConfigPath,
        serverId: 'nocfg',
        name: 'nocfg',
        description: '',
        enabled: true,
        message: '',
        config: null,
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
      expect(inactive).toEqual({ 'mcp__ok__t': onlyTool });
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
        config: { transport: 'http', url: 'http://good', enabled: true },
      });
      service['definitionsByPath'].set(badPath, {
        path: badPath,
        serverId: 'bad',
        name: 'bad',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://bad', enabled: true },
      });

      const goodTool = { execute: jest.fn() };
      (getBundledLib as jest.Mock).mockResolvedValue({
        createMCPClient: jest.fn().mockImplementation(async ({ transport }: { transport: { url: string } }) => {
          if (transport.url === 'http://bad') {
            throw new Error('connection refused');
          }
          return {
            tools: jest.fn().mockResolvedValue({ u: goodTool }),
            close: jest.fn().mockResolvedValue(undefined),
          };
        }),
      });

      const { inactive } = await service.getMcpToolsForConversation('Y');

      expect(inactive).toEqual({ 'mcp__good__u': goodTool });
      expect(Object.keys(inactive)).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to connect MCP server for Steward/MCP/bad-conn.md',
        expect.any(Error)
      );
    });
  });

  describe('removeDefinitionByPath', () => {
    it('closes the MCP client and removes cached connection', async () => {
      const mockClose = jest.fn().mockResolvedValue(undefined);
      const path = 'Steward/MCP/gone.md';
      service['connectedByPath'].set(path, {
        definitionPath: path,
        client: { close: mockClose } as unknown as MCPClient,
        tools: {},
      });
      service['definitionsByPath'].set(path, {
        path,
        serverId: 'gone',
        name: 'gone',
        description: '',
        enabled: true,
        message: '',
        config: { transport: 'http', url: 'http://x', enabled: true },
      });

      service['removeDefinitionByPath'](path);

      await Promise.resolve();
      expect(mockClose).toHaveBeenCalled();
      expect(service['connectedByPath'].has(path)).toBe(false);
      expect(service['definitionsByPath'].has(path)).toBe(false);
    });
  });
});
