import { TAbstractFile, TFile, normalizePath } from 'obsidian';
import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import type { ParsedYamlFenceBlock } from '../MarkdownDefinitionService/types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';
import { ToolName } from 'src/solutions/commands/toolNames';
import {
  toolInstructionBlockSchema,
  type ToolInstructionBlock,
  type ToolInstructionValidationResult,
} from './types';

const { i18next } = getBundledInternal('i18n');

const TOOL_INSTRUCTION_BLOCK_NAME = 'tool_instruction';

interface CollectedToolInstructionBlocks {
  blocks: ParsedYamlFenceBlock[];
  parseErrors: string[];
}

/**
 * Reads and validates `Steward/Memory/Tool instructions.md`.
 * Model-editable YAML fences provide per-tool guidelines merged into agent prompts.
 */
export class ToolInstructionService {
  private static instance: ToolInstructionService | null = null;
  private initialized = false;
  private guidelinesByTool: Map<ToolName, string[]> = new Map();

  private constructor(private readonly plugin: StewardPlugin) {}

  public static getInstance(plugin: StewardPlugin): ToolInstructionService {
    if (!ToolInstructionService.instance) {
      ToolInstructionService.instance = new ToolInstructionService(plugin);
    }
    return ToolInstructionService.instance;
  }

  public initialize(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const handleDefinitionFile = (file: TAbstractFile) => {
      if (!(file instanceof TFile)) {
        return;
      }
      if (!this.isToolInstructionsPath(file.path)) {
        return;
      }
      void this.validateAndUpdateFrontmatter(file);
    };

    this.plugin.app.workspace.onLayoutReady(() => {
      void this.ensureMemoryFolderAndDefaultFile()
        .then(() => this.reloadFromVault())
        .catch(error => {
          logger.error('ToolInstructionService startup failed:', error);
        });

      this.plugin.registerEvent(this.plugin.app.vault.on('create', handleDefinitionFile));
    });

    this.plugin.registerEvent(this.plugin.app.vault.on('modify', handleDefinitionFile));
  }

  public getMemoryFolderPath(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/Memory`);
  }

  public getToolInstructionsFilePath(): string {
    return normalizePath(`${this.getMemoryFolderPath()}/Tool instructions.md`);
  }

  /** Relative path from vault root for user-facing messages. */
  public getToolInstructionsRelativePath(): string {
    return `${this.plugin.settings.stewardFolder}/Memory/Tool instructions.md`;
  }

  /**
   * Merges two per-tool guideline maps. Secondary entries are appended after primary for each tool.
   */
  public mergeToolGuidelineMaps(
    primary: Map<ToolName, string[]>,
    secondary: Map<ToolName, string[]>
  ): Map<ToolName, string[]> {
    const merged = new Map<ToolName, string[]>();

    for (const [tool, lines] of primary) {
      merged.set(tool, [...lines]);
    }

    for (const [tool, lines] of secondary) {
      const existing = merged.get(tool);
      if (existing) {
        merged.set(tool, [...existing, ...lines]);
        continue;
      }
      merged.set(tool, [...lines]);
    }

    return merged;
  }

  public async ensureMemoryFolderAndDefaultFile(): Promise<void> {
    const folderPath = this.getMemoryFolderPath();
    await this.plugin.obsidianAPITools.ensureFolderExists(folderPath);

    const filePath = this.getToolInstructionsFilePath();
    const existing = this.plugin.app.vault.getFileByPath(filePath);
    if (existing) {
      return;
    }

    const initialContent = this.buildDefaultFileContent();
    await this.plugin.app.vault.create(filePath, initialContent);
  }

  public buildStatusMessage(valid: boolean, errors?: string[]): string {
    if (valid) {
      return i18next.t('common.statusValid');
    }
    const combinedErrors = (errors ?? []).join('; ');
    return i18next.t('common.statusInvalid', { errors: combinedErrors });
  }

  public isToolInstructionsPath(filePath: string): boolean {
    return normalizePath(filePath) === this.getToolInstructionsFilePath();
  }

  public getInstructionsByTool(): Map<ToolName, string[]> {
    return new Map(this.guidelinesByTool);
  }

  public hasGuidelinesForTool(toolName: ToolName): boolean {
    const lines = this.guidelinesByTool.get(toolName);
    return !!lines && lines.length > 0;
  }

  /** Tools in the list that have at least one memory-backed guideline. */
  public filterToolsWithGuidelines(toolNames: readonly ToolName[]): ToolName[] {
    const result: ToolName[] = [];
    for (let i = 0; i < toolNames.length; i++) {
      const tool = toolNames[i];
      if (this.hasGuidelinesForTool(tool)) {
        result.push(tool);
      }
    }
    return result;
  }

  public validateContent(params: {
    content: string;
    file: TFile;
  }): ToolInstructionValidationResult {
    const collected = this.collectToolInstructionBlocks(params);
    return this.validateCollectedBlocks(collected);
  }

  public async validateAndUpdateFrontmatter(file: TFile): Promise<ToolInstructionValidationResult> {
    const content = await this.plugin.app.vault.read(file);
    const validation = this.validateContent({ content, file });
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const enabledRaw = fileCache?.frontmatter?.enabled;
    const fileEnabled = enabledRaw !== false && enabledRaw !== 'false';
    this.guidelinesByTool = fileEnabled ? validation.guidelinesByTool : new Map();
    await this.applyValidationFrontmatter(file, validation);
    return validation;
  }

  public async reloadFromVault(): Promise<void> {
    const filePath = this.getToolInstructionsFilePath();
    const file = this.plugin.app.vault.getFileByPath(filePath);
    if (!file) {
      this.guidelinesByTool = new Map();
      return;
    }
    await this.validateAndUpdateFrontmatter(file);
  }

  private buildDefaultFileContent(): string {
    return [
      `## ${ToolName.SHELL}`,
      '',
      'Add additional guidelines for this tool here (one string per line).',
      '',
      '```yaml',
      'name: tool_instruction',
      `tool: ${ToolName.SHELL}`,
      'enabled: false',
      'guidelines:',
      '  - (enable this block and add one string per line)',
      '```',
      '',
    ].join('\n');
  }

  private get markdownDefinitionService(): MarkdownDefinitionService {
    return this.plugin.markdownDefinitionService;
  }

  private collectToolInstructionBlocks(params: {
    content: string;
    file: TFile;
  }): CollectedToolInstructionBlocks {
    const { blocks, parseErrors } = this.markdownDefinitionService.collectAllYamlBlocks({
      file: params.file,
      content: params.content,
    });

    const toolBlocks: ParsedYamlFenceBlock[] = [];
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
      if (nameRaw === TOOL_INSTRUCTION_BLOCK_NAME) {
        toolBlocks.push(block);
        continue;
      }
      formattedParseErrors.push(
        `yaml fence at line ${block.startLine + 1}: unsupported block name "${nameRaw}" (only "${TOOL_INSTRUCTION_BLOCK_NAME}" is allowed)`
      );
    }

    return {
      blocks: toolBlocks,
      parseErrors: formattedParseErrors,
    };
  }

  private validateCollectedBlocks(
    collected: CollectedToolInstructionBlocks
  ): ToolInstructionValidationResult {
    const errors: string[] = [...collected.parseErrors];
    const parsedBlocks: ToolInstructionBlock[] = [];

    for (let i = 0; i < collected.blocks.length; i++) {
      const block = collected.blocks[i];
      const parsed = toolInstructionBlockSchema.safeParse(block.data);
      if (!parsed.success) {
        errors.push(
          ...this.formatSchemaErrors(
            `tool_instruction at line ${block.startLine + 1}`,
            parsed.error
          )
        );
        continue;
      }
      if (parsed.data.enabled === false) {
        continue;
      }
      parsedBlocks.push(parsed.data);
    }

    const guidelinesByTool = this.buildGuidelinesMap(parsedBlocks);
    const valid = errors.length === 0;
    const statusMessage = this.buildStatusMessage(valid, valid ? undefined : errors);

    if (!valid) {
      logger.warn(`Invalid tool instructions at ${this.getToolInstructionsFilePath()}:`, errors);
    }

    return {
      valid,
      errors,
      statusMessage,
      guidelinesByTool,
    };
  }

  private buildGuidelinesMap(blocks: ToolInstructionBlock[]): Map<ToolName, string[]> {
    const map = new Map<ToolName, string[]>();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const existing = map.get(block.tool);
      if (existing) {
        map.set(block.tool, [...existing, ...block.guidelines]);
        continue;
      }
      map.set(block.tool, [...block.guidelines]);
    }
    return map;
  }

  private async applyValidationFrontmatter(
    file: TFile,
    validation: ToolInstructionValidationResult
  ): Promise<void> {
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter ?? {};
    const currentStatusRaw = frontmatter.status;
    const currentStatus = typeof currentStatusRaw === 'string' ? currentStatusRaw : undefined;
    const enabledKeyMissing = !Object.prototype.hasOwnProperty.call(frontmatter, 'enabled');
    const needsStatusUpdate = currentStatus !== validation.statusMessage;
    const needsEnabledDefault = enabledKeyMissing;

    if (!needsStatusUpdate && !needsEnabledDefault) {
      return;
    }

    try {
      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        if (needsStatusUpdate) {
          fm.status = validation.statusMessage;
        }
        if (needsEnabledDefault) {
          fm.enabled = true;
        }
      });
    } catch (error) {
      logger.error(`Failed to update tool instructions frontmatter for ${file.path}`, error);
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
