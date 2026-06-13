import { TFile, normalizePath } from 'obsidian';
import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import type { ParsedYamlFenceBlock } from '../MarkdownDefinitionService/types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';
import { BUNDLED_SUB_AGENTS } from 'src/generated/subAgents';
import {
  subAgentDefinitionBlockSchema,
  type SubAgentCatalogEntry,
  type SubAgentDefinition,
  type SubAgentDefinitionValidationResult,
} from './types';

const { i18next } = getBundledInternal('i18n');

const SUB_AGENTS_FILE_NAME = 'Sub Agents.md';
const AGENT_BLOCK_NAME = 'agent';

interface CollectedSubAgentBlocks {
  agentBlocks: ParsedYamlFenceBlock[];
  parseErrors: string[];
}

/**
 * Reads and validates `{stewardFolder}/Sub Agents.md`.
 * YAML `name: agent` fences define specialized sub-agents for the spawn catalog.
 */
export class SubAgentDefinitionService {
  private static instance: SubAgentDefinitionService | null = null;
  private initialized = false;
  private definitionsById: Map<string, SubAgentDefinition> = new Map();

  private constructor(private readonly plugin: StewardPlugin) {}

  public static getInstance(plugin: StewardPlugin): SubAgentDefinitionService {
    if (!SubAgentDefinitionService.instance) {
      SubAgentDefinitionService.instance = new SubAgentDefinitionService(plugin);
    }
    return SubAgentDefinitionService.instance;
  }

  public initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on('changed', file => {
        if (!(file instanceof TFile)) {
          return;
        }
        if (!this.isDefinitionFilePath(file.path)) {
          return;
        }

        void this.validateAndUpdateFrontmatter(file);
      })
    );

    this.plugin.app.workspace.onLayoutReady(() => {
      void this.ensureDefinitionFile()
        .then(() => this.reloadFromVault())
        .catch(error => {
          logger.error('SubAgentDefinitionService startup failed:', error);
        });
    });
  }

  public getDefinitionFilePath(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/${SUB_AGENTS_FILE_NAME}`);
  }

  public getDefinitionRelativePath(): string {
    return `${this.plugin.settings.stewardFolder}/${SUB_AGENTS_FILE_NAME}`;
  }

  public isDefinitionFilePath(filePath: string): boolean {
    return normalizePath(filePath) === this.getDefinitionFilePath();
  }

  public buildStatusMessage(valid: boolean, errors?: string[]): string {
    if (valid) {
      return i18next.t('common.statusValid');
    }
    const combinedErrors = (errors ?? []).join('; ');
    return i18next.t('common.statusInvalid', { errors: combinedErrors });
  }

  public getCatalog(): SubAgentCatalogEntry[] {
    const entries: SubAgentCatalogEntry[] = [];

    for (const definition of this.definitionsById.values()) {
      if (!definition.enabled) {
        continue;
      }
      entries.push({
        id: definition.id,
        description: definition.description,
      });
    }

    entries.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }

  public getDefinition(id: string): SubAgentDefinition | null {
    return this.definitionsById.get(id) ?? null;
  }

  public validateContent(params: {
    content: string;
    file: TFile;
  }): SubAgentDefinitionValidationResult {
    const collected = this.collectSubAgentBlocks(params);
    return this.validateCollectedBlocks(collected);
  }

  public async validateAndUpdateFrontmatter(
    file: TFile
  ): Promise<SubAgentDefinitionValidationResult> {
    const content = await this.plugin.app.vault.read(file);
    const validation = this.validateContent({ content, file });
    this.definitionsById = validation.definitionsById;
    await this.applyValidationFrontmatter(file, validation);
    return validation;
  }

  public async reloadFromVault(): Promise<void> {
    const filePath = this.getDefinitionFilePath();
    const file = this.plugin.app.vault.getFileByPath(filePath);
    if (!file) {
      this.definitionsById = new Map();
      return;
    }
    await this.validateAndUpdateFrontmatter(file);
  }

  public async ensureDefinitionFile(): Promise<void> {
    const filePath = this.getDefinitionFilePath();
    const existingFile = this.plugin.app.vault.getFileByPath(filePath);

    if (!existingFile) {
      await this.plugin.app.vault.create(filePath, BUNDLED_SUB_AGENTS.content);
      logger.log(`Created sub-agents definition: ${filePath}`);
      return;
    }

    try {
      const content = await this.plugin.app.vault.cachedRead(existingFile);
      const parsed = this.plugin.noteContentService.parseMarkdownFrontmatter(content);
      const existingVersion = parsed.frontmatter.version as number | undefined;

      if (existingVersion !== undefined && existingVersion >= BUNDLED_SUB_AGENTS.version) {
        return;
      }

      logger.log(
        `Upgrading sub-agents definition (v${existingVersion ?? 0} -> v${BUNDLED_SUB_AGENTS.version})`
      );
      await this.plugin.app.vault.modify(existingFile, BUNDLED_SUB_AGENTS.content);
    } catch (error) {
      logger.error('Failed to upgrade sub-agents definition:', error);
    }
  }

  private get markdownDefinitionService(): MarkdownDefinitionService {
    return this.plugin.markdownDefinitionService;
  }

  private collectSubAgentBlocks(params: { content: string; file: TFile }): CollectedSubAgentBlocks {
    const { blocks, parseErrors } = this.markdownDefinitionService.collectAllYamlBlocks({
      file: params.file,
      content: params.content,
    });

    const agentBlocks: ParsedYamlFenceBlock[] = [];
    const formattedParseErrors: string[] = [];

    for (let i = 0; i < parseErrors.length; i++) {
      const parseError = parseErrors[i];
      formattedParseErrors.push(`yaml fence at line ${parseError.line}: ${parseError.message}`);
    }

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const nameRaw = block.data.name;
      if (typeof nameRaw !== 'string') {
        continue;
      }
      if (nameRaw === AGENT_BLOCK_NAME) {
        agentBlocks.push(block);
        continue;
      }
      formattedParseErrors.push(
        `yaml fence at line ${block.startLine + 1}: unsupported block name "${nameRaw}" (only "${AGENT_BLOCK_NAME}" is allowed)`
      );
    }

    return {
      agentBlocks,
      parseErrors: formattedParseErrors,
    };
  }

  private validateCollectedBlocks(
    collected: CollectedSubAgentBlocks
  ): SubAgentDefinitionValidationResult {
    const errors: string[] = [...collected.parseErrors];
    const definitionsById = new Map<string, SubAgentDefinition>();
    const idsSeen = new Set<string>();

    for (let i = 0; i < collected.agentBlocks.length; i++) {
      const block = collected.agentBlocks[i];
      const parsed = subAgentDefinitionBlockSchema.safeParse(block.data);
      if (!parsed.success) {
        errors.push(
          ...this.formatSchemaErrors(`agent at line ${block.startLine + 1}`, parsed.error)
        );
        continue;
      }

      if (parsed.data.enabled === false) {
        continue;
      }

      if (idsSeen.has(parsed.data.id)) {
        errors.push(`agent: duplicate id "${parsed.data.id}"`);
        continue;
      }
      idsSeen.add(parsed.data.id);

      definitionsById.set(parsed.data.id, {
        id: parsed.data.id,
        description: parsed.data.description,
        instruction: parsed.data.instruction,
        model: parsed.data.model,
        enabled: true,
        tools: parsed.data.tools,
        inactiveTools: parsed.data.inactiveTools,
      });
    }

    const valid = errors.length === 0;
    const statusMessage = this.buildStatusMessage(valid, valid ? undefined : errors);

    if (!valid) {
      logger.warn(`Invalid sub-agents definition at ${this.getDefinitionFilePath()}:`, errors);
    }

    return {
      valid,
      errors,
      statusMessage,
      definitionsById,
    };
  }

  private async applyValidationFrontmatter(
    file: TFile,
    validation: SubAgentDefinitionValidationResult
  ): Promise<void> {
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter ?? {};
    const currentStatusRaw = frontmatter.status;
    const currentStatus = typeof currentStatusRaw === 'string' ? currentStatusRaw : undefined;
    const needsStatusUpdate = currentStatus !== validation.statusMessage;

    if (!needsStatusUpdate) {
      return;
    }

    try {
      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        fm.status = validation.statusMessage;
      });
    } catch (error) {
      logger.error(`Failed to update sub-agents frontmatter for ${file.path}`, error);
    }
  }

  private formatSchemaErrors(prefix: string, error: z.ZodError): string[] {
    const messages: string[] = [];
    for (let i = 0; i < error.issues.length; i++) {
      const issue = error.issues[i];
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      messages.push(`${prefix}: ${path}${issue.message}`);
    }
    return messages;
  }
}
