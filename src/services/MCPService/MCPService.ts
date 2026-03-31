import { normalizePath, parseYaml, TFile } from 'obsidian';
import type { ModelMessage } from 'ai';
import type StewardPlugin from 'src/main';
import i18next from 'src/i18n';
import { logger } from 'src/utils/logger';
import { getBundledLib } from 'src/utils/bundledLibs';
import { MCPConnectedServer, MCPDefinition, MCPServerConfig, mcpServerConfigSchema } from './types';

const MCP_FOLDER_NAME = 'MCP';
const CONVERSATION_TOOLS_FRONTMATTER_KEY = 'tools';
const MCP_TOOL_PREFIX = 'mcp__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasExecuteMethod(value: unknown): value is {
  execute: (input: unknown, context: { messages: ModelMessage[]; toolCallId: string }) => unknown;
} {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.execute === 'function';
}

export class MCPService {
  private static instance: MCPService | null = null;

  private definitionsByPath: Map<string, MCPDefinition> = new Map();
  private connectedByPath: Map<string, MCPConnectedServer> = new Map();

  private constructor(private plugin: StewardPlugin) {
    this.initialize();
  }

  public static getInstance(plugin?: StewardPlugin): MCPService {
    if (plugin) {
      MCPService.instance = new MCPService(plugin);
      return MCPService.instance;
    }

    if (!MCPService.instance) {
      throw new Error('MCPService must be initialized with a plugin');
    }

    return MCPService.instance;
  }

  public get mcpFolder(): string {
    return `${this.plugin.settings.stewardFolder}/${MCP_FOLDER_NAME}`;
  }

  public isMCPToolName(toolName: string): boolean {
    return toolName.startsWith(MCP_TOOL_PREFIX);
  }

  public async getDefinitionMessageByPath(path: string): Promise<string | null> {
    const normalizedPath = normalizePath(path);
    if (!this.isMCPDefinitionPath(normalizedPath)) {
      return null;
    }

    await this.ensureDefinitionLoaded(normalizedPath);
    const definition = this.definitionsByPath.get(normalizedPath);
    if (!definition) {
      return null;
    }

    if (definition.message.trim().length > 0) {
      return definition.message.trim();
    }

    if (definition.description.trim().length > 0) {
      return definition.description.trim();
    }

    if (definition.name.trim().length > 0) {
      return definition.name.trim();
    }

    return normalizedPath;
  }

  /**
   * MCP tools listed in conversation `tools` frontmatter → `active`; others → `inactive`.
   * MCP tools are passed to the model as dynamic calls (not in the static tools schema).
   */
  public async getMcpToolsForConversation(conversationTitle: string): Promise<{
    active: Record<string, unknown>;
    inactive: Record<string, unknown>;
  }> {
    const activatedNames = await this.getConversationActivatedToolNames(conversationTitle);
    const active: Record<string, unknown> = {};
    const inactive: Record<string, unknown> = {};

    for (const definition of this.definitionsByPath.values()) {
      if (!definition.enabled || !definition.config) {
        continue;
      }

      const connected = await this.ensureServerConnected(definition.path);
      if (!connected) {
        continue;
      }

      for (const toolEntry of Object.entries(connected.tools)) {
        const toolName = toolEntry[0];
        const tool = toolEntry[1];
        const bucket = activatedNames.has(toolName) ? active : inactive;
        bucket[toolName] = tool;
      }
    }

    return { active, inactive };
  }

  public async executeActiveToolCall(params: {
    conversationTitle: string;
    toolCall: {
      toolName: string;
      input: unknown;
      toolCallId: string;
    };
    messages: ModelMessage[];
  }): Promise<unknown> {
    const mcpTools = await this.getMcpToolsForConversation(params.conversationTitle);
    const tool = mcpTools.active[params.toolCall.toolName];
    if (!hasExecuteMethod(tool)) {
      return null;
    }

    return tool.execute(params.toolCall.input, {
      messages: params.messages,
      toolCallId: params.toolCall.toolCallId,
    });
  }

  public async closeAll(): Promise<void> {
    const connectedServers = Array.from(this.connectedByPath.values());
    this.connectedByPath.clear();

    for (const connectedServer of connectedServers) {
      try {
        await connectedServer.client.close();
      } catch (error) {
        logger.warn(`Error closing MCP client for ${connectedServer.definitionPath}`, error);
      }
    }
  }

  private initialize(): void {
    this.plugin.app.workspace.onLayoutReady(async () => {
      await this.loadAllDefinitions();
    });

    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', file => {
        if (!(file instanceof TFile) || !this.isMCPDefinitionPath(file.path)) {
          return;
        }
        this.loadDefinitionFromFile(file);
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on('create', file => {
        if (!(file instanceof TFile) || !this.isMCPDefinitionPath(file.path)) {
          return;
        }
        this.loadDefinitionFromFile(file);
      })
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on('delete', file => {
        if (!(file instanceof TFile) || !this.isMCPDefinitionPath(file.path)) {
          return;
        }
        this.removeDefinitionByPath(file.path);
      })
    );
  }

  private isMCPDefinitionPath(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const normalizedFolder = normalizePath(this.mcpFolder);
    return normalizedPath.startsWith(`${normalizedFolder}/`) && normalizedPath.endsWith('.md');
  }

  private async loadAllDefinitions(): Promise<void> {
    const folder = this.plugin.app.vault.getFolderByPath(this.mcpFolder);
    if (!folder) {
      return;
    }

    this.definitionsByPath.clear();
    await this.closeAll();

    const files = this.plugin.obsidianAPITools.getFilesFromFolder(folder);
    for (const file of files) {
      if (file.extension !== 'md') {
        continue;
      }
      await this.loadDefinitionFromFile(file);
    }
  }

  private async loadDefinitionFromFile(file: TFile): Promise<void> {
    const normalizedPath = normalizePath(file.path);
    this.removeDefinitionByPath(normalizedPath);

    let content = '';
    try {
      content = await this.plugin.app.vault.cachedRead(file);
    } catch (error) {
      logger.warn(`Failed to read MCP definition file ${normalizedPath}`, error);
      return;
    }

    const parsedForStatus = this.extractFrontmatterAndBody(content);
    const currentStatusRaw = parsedForStatus.frontmatter.status;
    const currentStatus = typeof currentStatusRaw === 'string' ? currentStatusRaw : undefined;
    const enabledKeyMissing = !Object.prototype.hasOwnProperty.call(
      parsedForStatus.frontmatter,
      'enabled'
    );

    const { definition, configValidationErrors } = this.parseDefinition({
      filePath: normalizedPath,
      fileBasename: file.basename,
      content,
    });
    this.definitionsByPath.set(normalizedPath, definition);

    const newStatus = this.buildMcpDefinitionStatusMessage(
      configValidationErrors.length === 0,
      configValidationErrors.length === 0 ? undefined : configValidationErrors
    );

    const needsStatusUpdate = currentStatus !== newStatus;
    const needsEnabledDefault = enabledKeyMissing;

    if (needsStatusUpdate || needsEnabledDefault) {
      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        if (needsStatusUpdate) {
          fm.status = newStatus;
        }
        if (needsEnabledDefault) {
          fm.enabled = true;
        }
      });
    }
  }

  private async ensureDefinitionLoaded(path: string): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (this.definitionsByPath.has(normalizedPath)) {
      return;
    }

    const abstractFile = this.plugin.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(abstractFile instanceof TFile) || abstractFile.extension !== 'md') {
      return;
    }

    await this.loadDefinitionFromFile(abstractFile);
  }

  private parseDefinition(params: { filePath: string; fileBasename: string; content: string }): {
    definition: MCPDefinition;
    configValidationErrors: string[];
  } {
    const parsedMarkdown = this.extractFrontmatterAndBody(params.content);
    const frontmatter = parsedMarkdown.frontmatter;
    const jsonBlock = this.extractFirstJsonBlock(parsedMarkdown.body);

    const validation = this.validateServerConfigJson(jsonBlock.jsonContent, params.filePath);
    const config = validation.errors.length === 0 ? validation.config : null;
    const enabledFromFrontmatter = this.toBoolean(frontmatter.enabled, true);
    const enabledFromConfig = config !== null && config.enabled !== false;
    const enabled = enabledFromFrontmatter && enabledFromConfig;

    const nameValue = this.toString(frontmatter.name);
    const descriptionValue = this.toString(frontmatter.description);
    const name = nameValue || params.fileBasename;
    const description = descriptionValue || '';

    const message = jsonBlock.bodyWithoutJson.trim();
    const serverId = this.serverIdFromBasename(params.fileBasename);

    return {
      definition: {
        path: params.filePath,
        serverId,
        name,
        description,
        enabled,
        message,
        config,
      },
      configValidationErrors: validation.errors,
    };
  }

  private buildMcpDefinitionStatusMessage(valid: boolean, errors?: string[]): string {
    if (valid) {
      return i18next.t('common.statusValid');
    }
    const combinedErrors = (errors ?? []).join('; ');
    return i18next.t('common.statusInvalid', { errors: combinedErrors });
  }

  private validateServerConfigJson(
    jsonContent: string | null,
    filePath: string
  ): { config: MCPServerConfig | null; errors: string[] } {
    const errors: string[] = [];
    if (!jsonContent) {
      errors.push(i18next.t('mcp.noConfigBlock'));
      return { config: null, errors };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(i18next.t('mcp.invalidJson', { message }));
      return { config: null, errors };
    }

    try {
      const expanded = this.expandSecretPlaceholders(parsedJson);
      const result = mcpServerConfigSchema.safeParse(expanded);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const pathPrefix = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
          errors.push(`${pathPrefix}${issue.message}`);
        }
        return { config: null, errors };
      }
      return { config: result.data, errors: [] };
    } catch (error) {
      logger.warn(`Failed to parse MCP config for ${filePath}`, error);
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      return { config: null, errors };
    }
  }

  private extractFrontmatterAndBody(content: string): {
    frontmatter: Record<string, unknown>;
    body: string;
  } {
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
    const match = content.match(frontmatterRegex);
    if (!match || !match[1]) {
      return {
        frontmatter: {},
        body: content,
      };
    }

    let parsedFrontmatter: Record<string, unknown> = {};
    try {
      const parsedYaml = parseYaml(match[1]);
      if (isRecord(parsedYaml)) {
        parsedFrontmatter = parsedYaml;
      }
    } catch (error) {
      logger.warn('Failed to parse MCP frontmatter', error);
    }

    const body = content.slice(match[0].length);
    return {
      frontmatter: parsedFrontmatter,
      body,
    };
  }

  private extractFirstJsonBlock(body: string): {
    jsonContent: string | null;
    bodyWithoutJson: string;
  } {
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/i;
    const match = body.match(jsonRegex);
    if (!match || !match[1]) {
      return {
        jsonContent: null,
        bodyWithoutJson: body,
      };
    }

    const jsonContent = match[1].trim();
    const bodyWithoutJson = body.replace(jsonRegex, '').trim();
    return {
      jsonContent,
      bodyWithoutJson,
    };
  }

  private expandSecretPlaceholders(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.replaceSecretPlaceholder(value);
    }

    if (Array.isArray(value)) {
      const expandedArray: unknown[] = [];
      for (const item of value) {
        expandedArray.push(this.expandSecretPlaceholders(item));
      }
      return expandedArray;
    }

    if (!isRecord(value)) {
      return value;
    }

    const expandedObject: Record<string, unknown> = {};
    const entries = Object.entries(value);
    for (const entry of entries) {
      const key = entry[0];
      const nestedValue = entry[1];
      expandedObject[key] = this.expandSecretPlaceholders(nestedValue);
    }
    return expandedObject;
  }

  private replaceSecretPlaceholder(input: string): string {
    const secretRegex = /\$secret:([a-zA-Z0-9._-]+)/g;
    return input.replace(secretRegex, (fullMatch, secretName: string) => {
      const secretValue = this.plugin.app.secretStorage.getSecret(secretName);
      if (secretValue === null) {
        logger.warn(`MCP secret not found for placeholder: ${secretName}`);
        return fullMatch;
      }
      return secretValue;
    });
  }

  private toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const lowered = value.toLowerCase().trim();
      if (lowered === 'true') {
        return true;
      }
      if (lowered === 'false') {
        return false;
      }
    }
    return fallback;
  }

  private toString(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    return '';
  }

  /** Stable segment for `mcp__{serverId}__{tool}`; derived from note basename only. */
  private serverIdFromBasename(fileBasename: string): string {
    const id = fileBasename
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return id || 'mcp_server';
  }

  private async getConversationActivatedToolNames(conversationTitle: string): Promise<Set<string>> {
    const values = await this.plugin.conversationRenderer.getConversationProperty<unknown>(
      conversationTitle,
      CONVERSATION_TOOLS_FRONTMATTER_KEY
    );

    if (!Array.isArray(values)) {
      return new Set();
    }

    const names = new Set<string>();
    for (const value of values) {
      if (typeof value !== 'string' || value.length === 0) {
        continue;
      }
      names.add(value);
    }
    return names;
  }

  private async ensureServerConnected(path: string): Promise<MCPConnectedServer | null> {
    const normalizedPath = normalizePath(path);
    const existing = this.connectedByPath.get(normalizedPath);
    if (existing) {
      return existing;
    }

    const definition = this.definitionsByPath.get(normalizedPath);
    if (!definition || !definition.enabled || !definition.config) {
      return null;
    }

    const mcpLib = await getBundledLib('mcp');
    try {
      const client = await mcpLib.createMCPClient({
        transport: {
          type: definition.config.transport,
          url: definition.config.url,
          headers: definition.config.headers,
        },
      });
      const discoveredTools = await client.tools();

      const prefixedTools: MCPConnectedServer['tools'] = {};
      const discoveredEntries = Object.entries(discoveredTools);
      for (const discoveredEntry of discoveredEntries) {
        const toolName = discoveredEntry[0];
        const tool = discoveredEntry[1];
        const prefixedName = `${MCP_TOOL_PREFIX}${definition.serverId}__${toolName}`;
        prefixedTools[prefixedName] = tool;
      }

      const connectedServer: MCPConnectedServer = {
        definitionPath: normalizedPath,
        client,
        tools: prefixedTools,
      };
      this.connectedByPath.set(normalizedPath, connectedServer);
      return connectedServer;
    } catch (error) {
      logger.warn(`Failed to connect MCP server for ${normalizedPath}`, error);
      return null;
    }
  }

  private removeDefinitionByPath(path: string): void {
    const normalizedPath = normalizePath(path);
    this.definitionsByPath.delete(normalizedPath);
    const existing = this.connectedByPath.get(normalizedPath);
    if (!existing) {
      return;
    }

    this.connectedByPath.delete(normalizedPath);
    existing.client.close().catch(error => {
      logger.warn(`Error closing MCP client for ${normalizedPath}`, error);
    });
  }
}
