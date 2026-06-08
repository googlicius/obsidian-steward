import { getLanguage, normalizePath, Notice, TAbstractFile, TFile, TFolder } from 'obsidian';
import { getBundledLib } from 'src/utils/bundledLibs';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import { COMMAND_PREFIXES, WIKI_LINK_PATTERN } from 'src/constants';
import { BUILT_IN_UDCS } from './constants';
import { ChatView } from 'src/views/ChatView';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { z } from 'zod/v3';
import {
  IVersionedUserDefinedCommand,
  NormalizedUserDefinedCommand,
  TriggerCondition,
  type UdcTemplateContext,
} from './versions/types';
import { loadUDCVersion } from './versions/loader';
import { Intent, IntentResultStatus } from 'src/solutions/commands/types';
import { SearchOperationV2 } from 'src/solutions/commands/agents/handlers';
import { migrateRawUdcObject, stringifyUdcYaml } from './migrateUdcLegacyUseTool';
import { evaluateStepWhen } from './stepConditions';
import type { ParsedYamlFenceBlock, YamlFenceReplacement } from '../MarkdownDefinitionService';

const { i18next } = getBundledInternal('i18n');
const t = i18next.t.bind(i18next);

const udcNoteFrontmatterSchema = z.object({
  enabled: z.boolean().optional(),
});

type CommandCatalog = {
  name: string;
  path: string;
  description?: string;
};

export class UserDefinedCommandService {
  private static instance: UserDefinedCommandService | null = null;
  // Store versioned commands - normalized format is accessed via normalize()
  public userDefinedCommands: Map<string, IVersionedUserDefinedCommand> = new Map();

  // Track files pending trigger checks (waiting for metadata cache update)
  private pendingTriggerChecks: Map<string, 'create' | 'modify' | 'delete'> = new Map();

  private constructor(private plugin: StewardPlugin) {
    this.initialize();
  }

  get commandFolder(): string {
    return `${this.plugin.settings.stewardFolder}/Commands`;
  }

  get commandProcessorService() {
    return this.plugin.commandProcessorService;
  }

  public static getInstance(plugin?: StewardPlugin): UserDefinedCommandService {
    if (plugin) {
      UserDefinedCommandService.instance = new UserDefinedCommandService(plugin);
      return UserDefinedCommandService.instance;
    }
    if (!UserDefinedCommandService.instance) {
      throw new Error('UserDefinedCommandService must be initialized with a plugin');
    }
    return UserDefinedCommandService.instance;
  }

  public buildExtendedPrefixes(commandPrefixes = COMMAND_PREFIXES) {
    const extendedPrefixes = [...commandPrefixes];
    const udcCommands = this.getCommandNames();
    for (const cmd of udcCommands) {
      extendedPrefixes.push('/' + cmd);
    }
    // Sort prefixes by length (longest first) to ensure we match the most specific command
    extendedPrefixes.sort((a, b) => b.length - a.length);
    return extendedPrefixes;
  }

  /**
   * Initialize the user-defined command service
   */
  private async initialize(): Promise<void> {
    try {
      // Create the commands folder if it doesn't exist
      // const folderExists = this.plugin.app.vault.getAbstractFileByPath(this.commandFolder);
      // if (!folderExists) {
      // 	await this.plugin.app.vault.createFolder(this.commandFolder);
      // }

      this.plugin.app.workspace.onLayoutReady(async () => {
        this.plugin.registerEvent(
          this.plugin.app.vault.on('create', file => {
            if (file instanceof TFile) {
              this.handleFileCreation(file);
            }
          })
        );

        // Load all command definitions
        await this.loadAllCommands();

        await this.seedBuiltInCommands();
      });

      this.plugin.registerEvent(
        this.plugin.app.vault.on('modify', file => {
          if (file instanceof TFile) {
            this.handleFileModification(file);
          }
        })
      );
      this.plugin.registerEvent(
        this.plugin.app.vault.on('delete', file => {
          if (file instanceof TFile) {
            this.handleFileDeletion(file);
          }
        })
      );
      this.plugin.registerEvent(
        this.plugin.app.vault.on('rename', (file, oldPath) => {
          void this.handleVaultRename(file, oldPath);
        })
      );

      // Listen to metadata cache changes for trigger checks
      this.plugin.registerEvent(
        this.plugin.app.metadataCache.on('changed', file => {
          this.handleMetadataChanged(file);
        })
      );
    } catch (error) {
      logger.error('Error initializing UserDefinedCommandService:', error);
    }
  }

  /**
   * Collect every markdown file under a folder tree (Commands supports nested folders).
   */
  private collectMarkdownFilesInFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        files.push(child);
        continue;
      }
      if (child instanceof TFolder) {
        files.push(...this.collectMarkdownFilesInFolder(child));
      }
    }
    return files;
  }

  /**
   * Load all command definitions from the Commands folder
   */
  private async loadAllCommands(): Promise<void> {
    const folder = this.plugin.app.vault.getFolderByPath(this.commandFolder);

    if (!folder) {
      return;
    }

    // Clear existing commands
    this.userDefinedCommands.clear();

    const mdFiles = this.collectMarkdownFilesInFolder(folder);
    for (const file of mdFiles) {
      await this.loadCommandFromFile(file);
    }

    logger.log(`Loaded ${this.userDefinedCommands.size} user-defined commands`);
  }

  /**
   * Seed built-in UDC notes under Steward/Commands when missing or when `version` is stale.
   */
  private async seedBuiltInCommands(): Promise<void> {
    await this.plugin.obsidianAPITools.ensureFolderExists(this.commandFolder);

    for (const udc of BUILT_IN_UDCS) {
      const commandPath = `${this.commandFolder}/${udc.name}.md`;
      const existingFile = this.plugin.app.vault.getFileByPath(commandPath);

      if (existingFile) {
        try {
          const content = await this.plugin.app.vault.cachedRead(existingFile);
          const parsed = this.plugin.noteContentService.parseMarkdownFrontmatter(content);
          const existingVersion = parsed.frontmatter.version as number | undefined;

          if (existingVersion !== undefined && existingVersion >= udc.version) {
            continue;
          }

          logger.log(
            `Upgrading built-in UDC ${udc.name} (v${existingVersion ?? 0} -> v${udc.version})`
          );
        } catch (error) {
          logger.error(`Error reading existing built-in UDC ${udc.name}:`, error);
          continue;
        }
      }

      try {
        const frontmatter = `---
status: ✅ Valid
enabled: true
version: ${udc.version}
---`;

        const fileContent = `${frontmatter}\n${udc.content}`;

        if (existingFile) {
          await this.plugin.app.vault.modify(existingFile, fileContent);
          logger.log(`Updated built-in UDC: ${udc.name} (v${udc.version})`);
          // await this.loadCommandFromFile(existingFile);
          continue;
        }

        const createdFile = await this.plugin.app.vault.create(commandPath, fileContent);
        logger.log(`Created built-in UDC: ${udc.name} (v${udc.version})`);
        if (createdFile) {
          // await this.loadCommandFromFile(createdFile);
        }
      } catch (error) {
        logger.error(`Error writing built-in UDC ${udc.name}:`, error);
      }
    }
  }

  /**
   * Load command definition from a file
   * @param file The file to load commands from
   */
  private async loadCommandFromFile(file: TFile): Promise<void> {
    try {
      // First, remove any existing commands from this file
      this.removeCommandsFromFile(file.path);

      const content = await this.plugin.app.vault.cachedRead(file);
      const parsedDoc = this.plugin.noteContentService.parseMarkdownFrontmatter(content);
      const fmParsed = udcNoteFrontmatterSchema.safeParse(parsedDoc.frontmatter);
      const noteEnabled = !fmParsed.success || fmParsed.data.enabled !== false;

      if (!parsedDoc.body) {
        logger.warn(`Stop loading command from "${file.name}", the body is empty`);
        return;
      }

      const commandYamlBlocks = this.collectCommandYamlBlocks(file, content);

      // Without a command YAML block the note is not a UDC definition (it may be a
      // referenced doc / system-prompt note), so leave its frontmatter untouched.
      if (commandYamlBlocks.length === 0) {
        logger.log('Not a command definition note, skipping...');
        return;
      }

      const validationErrors: Array<{
        commandName: string;
        errors: string[];
      }> = [];

      let definitionValid = false;
      const yamlReplacements: YamlFenceReplacement[] = [];

      for (const yamlBlock of commandYamlBlocks) {
        try {
          const migrated = migrateRawUdcObject(yamlBlock.data);
          const rawData: Record<string, unknown> = migrated.data;

          if (migrated.changed) {
            yamlReplacements.push({
              block: yamlBlock,
              newInner: stringifyUdcYaml(migrated.data),
            });
          }

          // Load and validate using version-aware loader (async imports)
          const result = await loadUDCVersion(
            rawData as { command_name: string; version?: number; [key: string]: unknown },
            file.path,
            noteEnabled
          );

          if (!result.success) {
            // Collect errors from parse function
            const commandName = (rawData.command_name as string) || 'unknown';
            validationErrors.push({
              commandName,
              errors: result.errors,
            });
            continue;
          }

          definitionValid = true;
          const versionedCommand = result.command;
          this.userDefinedCommands.set(versionedCommand.normalized.command_name, versionedCommand);
          logger.log(
            `Loaded user-defined command: ${versionedCommand.normalized.command_name} (v${versionedCommand.getVersion()})`
          );
        } catch (yamlError) {
          const errorMsg = yamlError instanceof Error ? yamlError.message : String(yamlError);
          validationErrors.push({
            commandName: 'unknown',
            errors: [i18next.t('validation.yamlError'), errorMsg],
          });
          logger.error(`Invalid YAML in file ${file.path}:`, yamlError);
        }
      }

      if (yamlReplacements.length > 0) {
        try {
          const updatedMarkdown = this.plugin.markdownDefinitionService.replaceYamlFenceContents(
            content,
            yamlReplacements
          );
          if (updatedMarkdown !== content) {
            await this.plugin.app.vault.modify(file, updatedMarkdown);
            for (const replacement of yamlReplacements) {
              logger.log(
                `Migrated legacy use_tool in UDC file: ${file.path} at line ${replacement.block.startLine + 1}`
              );
            }
          }
        } catch (persistError) {
          logger.error(`Failed to persist UDC migration for ${file.path}:`, persistError);
        }
      }

      const validForStatus = definitionValid && validationErrors.length === 0;
      await this.applyUdcValidationFrontmatter(parsedDoc, file, {
        valid: validForStatus,
        errorMessages: validForStatus ? [] : this.flattenValidationErrors(validationErrors),
      });
    } catch (error) {
      logger.error(`Error loading command from file ${file.path}:`, error);
    }
  }

  /**
   * Remove all commands that were loaded from a specific file
   * @param filePath The path of the file whose commands should be removed
   */
  private removeCommandsFromFile(filePath: string): void {
    // Find all commands that were loaded from this file
    const commandsToRemove: string[] = [];

    for (const [commandName, command] of this.userDefinedCommands.entries()) {
      if (command.normalized.file_path === filePath) {
        commandsToRemove.push(commandName);
      }
    }

    // Remove the found commands
    for (const commandName of commandsToRemove) {
      this.userDefinedCommands.delete(commandName);
      logger.log(`Removed command ${commandName} from ${filePath}`);
    }
  }

  /**
   * Walk Obsidian's markdown section cache and collect UDC YAML blocks.
   * A block is a command only when it is YAML, has `command_name`, and is not inside
   * a heading linked from an earlier command's system_prompt.
   */
  private collectCommandYamlBlocks(file: TFile, content: string): ParsedYamlFenceBlock[] {
    const walkState = {
      systemPromptHeadingNames: new Set<string>(),
      activeSystemPromptHeadingLevel: null as number | null,
    };

    return this.plugin.markdownDefinitionService.collectYamlBlocks({
      file,
      content,
      walkState,
      isMatch: data => typeof data.command_name === 'string',
      onHeadingSection: ({ section, lines }) => {
        const headingInfo = this.plugin.noteContentService.parseHeadingLine(
          lines[section.position.start.line] ?? ''
        );
        if (!headingInfo) {
          return;
        }

        if (walkState.activeSystemPromptHeadingLevel !== null) {
          if (headingInfo.level <= walkState.activeSystemPromptHeadingLevel) {
            walkState.activeSystemPromptHeadingLevel = null;
          }
          return;
        }

        if (walkState.systemPromptHeadingNames.has(headingInfo.text)) {
          walkState.activeSystemPromptHeadingLevel = headingInfo.level;
        }
      },
      shouldSkipCodeSection: () => walkState.activeSystemPromptHeadingLevel !== null,
      onBlockMatched: block => {
        this.collectHeadingOnlyWikilinks(block.content, walkState.systemPromptHeadingNames);
      },
    });
  }

  private collectHeadingOnlyWikilinks(content: string, headingNames: Set<string>): void {
    const wikiLinkRegex = new RegExp(WIKI_LINK_PATTERN, 'g');
    for (const match of content.matchAll(wikiLinkRegex)) {
      const linkContent = match[1];
      if (!linkContent) {
        continue;
      }

      const linkTarget = linkContent.split('|')[0].trim();
      if (!linkTarget.startsWith('#')) {
        continue;
      }

      const headingName = linkTarget.substring(1).trim();
      if (headingName.length === 0) {
        continue;
      }

      headingNames.add(headingName);
    }
  }

  /**
   * Check if a file matches folder patterns
   */
  private matchesFolderPattern(file: TFile, triggerFolders: string[]): boolean {
    if (!triggerFolders || triggerFolders.length === 0) {
      return true;
    }

    return triggerFolders.some(folder => {
      const normalizedFolder = normalizePath(folder);
      return file.path.startsWith(normalizedFolder);
    });
  }

  /**
   * Check if a file matches pattern
   * Supports 'tags' key for tag matching, 'content' for regex, and any frontmatter property
   */
  private matchesPattern(file: TFile, key: string, value: string | string[]): boolean {
    const values = Array.isArray(value) ? value : [value];

    // Special handling for tags
    if (key === 'tags') {
      const metadata = this.plugin.app.metadataCache.getFileCache(file);
      if (!metadata) {
        return false;
      }

      const fileTags = metadata.tags?.map(t => t.tag) || [];
      const frontmatterTags = metadata.frontmatter?.tags || [];
      const allTags = [
        ...fileTags,
        ...(Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags]),
      ];

      return values.some(tag => {
        const normalizedTag = tag.startsWith('#') ? tag : '#' + tag;
        return allTags.some(fileTag => {
          const normalizedFileTag = fileTag.startsWith('#') ? fileTag : '#' + fileTag;
          return normalizedFileTag === normalizedTag;
        });
      });
    }

    // Check frontmatter property
    const metadata = this.plugin.app.metadataCache.getFileCache(file);
    if (!metadata || !metadata.frontmatter) {
      return false;
    }

    const fileValue = metadata.frontmatter[key];
    if (fileValue === undefined) {
      return false;
    }

    return values.some(v => {
      if (Array.isArray(fileValue)) {
        return fileValue.includes(v);
      }
      return fileValue === v;
    });
  }

  /**
   * Check if file content matches regex pattern
   */
  private async matchesContentPattern(file: TFile, pattern: string): Promise<boolean> {
    if (!pattern) {
      return true;
    }

    try {
      const content = await this.plugin.app.vault.cachedRead(file);
      const regex = new RegExp(pattern);
      return regex.test(content);
    } catch (e) {
      logger.error(`Error matching content pattern: ${e.message}`);
      return false;
    }
  }

  /**
   * Evaluate if a file matches a trigger condition
   */
  private async evaluateTriggerCondition(params: {
    file: TFile;
    event: 'create' | 'modify' | 'delete';
    trigger: TriggerCondition;
  }): Promise<boolean> {
    const { file, event, trigger } = params;

    // Check if the event matches
    if (!trigger.events.includes(event)) {
      return false;
    }

    // Check folder match
    if (trigger.folders && trigger.folders.length > 0) {
      if (!this.matchesFolderPattern(file, trigger.folders)) {
        return false;
      }
    }

    // If no patterns specified, match only on event and folders
    if (!trigger.patterns) {
      return true;
    }

    // Check all patterns (all must match)
    for (const [key, value] of Object.entries(trigger.patterns)) {
      // Special handling for content pattern
      if (key === 'content') {
        const pattern = Array.isArray(value) ? value[0] : value;
        const matches = await this.matchesContentPattern(file, pattern);
        if (!matches) {
          return false;
        }
      } else {
        // Check tags or frontmatter properties
        if (!this.matchesPattern(file, key, value)) {
          return false;
        }
      }
    }

    return true;
  }

  private flattenValidationErrors(
    validationErrors: Array<{ commandName: string; errors: string[] }>
  ): string[] {
    const messages: string[] = [];
    for (const info of validationErrors) {
      const joined = info.errors.join(', ');
      if (info.commandName === 'unknown') {
        messages.push(joined);
        continue;
      }
      messages.push(`${info.commandName}: ${joined}`);
    }
    return messages;
  }

  private buildUdcDefinitionStatusMessage(valid: boolean, errors?: string[]): string {
    if (valid) {
      return i18next.t('common.statusValid');
    }
    const combinedErrors = (errors ?? []).join('; ');
    return i18next.t('common.statusInvalid', { errors: combinedErrors });
  }

  private async applyUdcValidationFrontmatter(
    parsedDoc: { frontmatter: Record<string, unknown> },
    file: TFile,
    params: { valid: boolean; errorMessages: string[] }
  ): Promise<void> {
    const newStatus = this.buildUdcDefinitionStatusMessage(
      params.valid,
      params.valid ? undefined : params.errorMessages
    );
    const currentStatusRaw = parsedDoc.frontmatter.status;
    const currentStatus = typeof currentStatusRaw === 'string' ? currentStatusRaw : undefined;
    const enabledKeyMissing = !Object.prototype.hasOwnProperty.call(
      parsedDoc.frontmatter,
      'enabled'
    );

    const needsStatusUpdate = currentStatus !== newStatus;
    const needsEnabledDefault = enabledKeyMissing;

    if (!needsStatusUpdate && !needsEnabledDefault) {
      return;
    }

    try {
      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        if (needsStatusUpdate) {
          fm.status = newStatus;
        }
        if (needsEnabledDefault) {
          fm.enabled = true;
        }
      });
    } catch (error) {
      logger.error(`Failed to update UDC frontmatter for ${file.path}`, error);
    }
  }

  /**
   * Handle file modification events
   */
  private async handleFileModification(file: TFile): Promise<void> {
    if (this.isCommandFile(file)) {
      await this.loadCommandFromFile(file);
    } else {
      // Add to pending queue - will check triggers when metadata cache updates
      this.pendingTriggerChecks.set(file.path, 'modify');
    }
  }

  /**
   * Handle file creation events
   */
  private async handleFileCreation(file: TFile): Promise<void> {
    if (this.isCommandFile(file)) {
      await this.loadCommandFromFile(file);
    } else {
      // Add to pending queue - will check triggers when metadata cache updates
      this.pendingTriggerChecks.set(file.path, 'create');
    }
  }

  /**
   * Handle file deletion events
   */
  private async handleFileDeletion(file: TFile): Promise<void> {
    if (this.isCommandFile(file)) {
      // Remove all commands associated with this file
      this.removeCommandsFromFile(file.path);
      logger.log(`Removed commands from deleted file: ${file.path}`);
    } else {
      // For delete events, check immediately (no metadata to wait for)
      await this.checkAndExecuteTriggers(file, 'delete');
    }
  }

  /**
   * Obsidian fires `rename` for moves (including VaultMove / fileManager.renameFile).
   * Drop registrations keyed by the old path, then reload if the note still lives under Commands.
   */
  private async handleVaultRename(file: TAbstractFile, oldPath: string): Promise<void> {
    if (file instanceof TFolder) {
      const oldUnder = this.isCommandPathPrefix(oldPath);
      const newUnder = this.isCommandPathPrefix(file.path);
      if (oldUnder || newUnder) {
        this.prunePendingTriggerChecksUnderPrefix(oldPath);
        await this.loadAllCommands();
      }
      return;
    }

    if (!(file instanceof TFile)) {
      return;
    }

    if (this.isCommandMarkdownPath(oldPath)) {
      this.removeCommandsFromFile(oldPath);
    }

    const pending = this.pendingTriggerChecks.get(oldPath);
    if (pending !== undefined) {
      this.pendingTriggerChecks.delete(oldPath);
      this.pendingTriggerChecks.set(file.path, pending);
    }

    if (this.isCommandFile(file)) {
      await this.loadCommandFromFile(file);
    }
  }

  private isCommandPathPrefix(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const normalizedCommandRoot = normalizePath(this.commandFolder);
    return (
      normalizedPath === normalizedCommandRoot ||
      normalizedPath.startsWith(`${normalizedCommandRoot}/`)
    );
  }

  private isCommandMarkdownPath(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const prefix = `${normalizePath(this.commandFolder)}/`;
    return normalizedPath.startsWith(prefix) && normalizedPath.toLowerCase().endsWith('.md');
  }

  private prunePendingTriggerChecksUnderPrefix(oldPathPrefix: string): void {
    const normalizedPrefix = normalizePath(oldPathPrefix);
    const keysToDelete: string[] = [];
    for (const key of this.pendingTriggerChecks.keys()) {
      const nk = normalizePath(key);
      if (nk === normalizedPrefix || nk.startsWith(`${normalizedPrefix}/`)) {
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      this.pendingTriggerChecks.delete(k);
    }
  }

  /**
   * Handle metadata cache changes
   * Process any pending trigger checks for this file
   */
  private async handleMetadataChanged(file: TFile): Promise<void> {
    const event = this.pendingTriggerChecks.get(file.path);
    if (!event) {
      return; // No pending check for this file
    }

    // Remove from pending queue
    this.pendingTriggerChecks.delete(file.path);

    // Now check triggers with updated metadata
    await this.checkAndExecuteTriggers(file, event);
  }

  /**
   * Check if a file is a command file
   */
  private isCommandFile(file: TFile): boolean {
    return file.extension === 'md' && this.isCommandMarkdownPath(file.path);
  }

  /**
   * Check if the pattern was newly added (not present before indexer updates)
   * Uses search service to query the old indexed state
   */
  private async isNewlyAddedPattern(params: {
    file: TFile;
    trigger: TriggerCondition;
  }): Promise<boolean> {
    const { file, trigger } = params;

    if (!trigger.patterns) {
      return true; // No patterns to check, consider it new
    }

    // Skip content pattern check (not supported in search yet)
    // Content changes are expected on modify, so we'd trigger anyway

    try {
      const operation: SearchOperationV2 = {
        keywords: [],
        filenames: [file.basename],
        folders: trigger.folders || [],
        properties: [],
      };

      // Process all patterns
      for (const [key, value] of Object.entries(trigger.patterns)) {
        // Skip content pattern (not searchable)
        if (key === 'content') {
          continue;
        }

        const values = Array.isArray(value) ? value : [value];

        // Handle tags specially
        if (key === 'tags') {
          for (const tag of values) {
            const tagValue = tag.startsWith('#') ? tag.substring(1) : tag;
            operation.properties.push({
              name: 'tag',
              value: tagValue,
            });
          }
        } else {
          // Handle as frontmatter property
          for (const val of values) {
            operation.properties.push({
              name: key,
              value: String(val),
            });
          }
        }
      }

      // Search for the file with these patterns in the OLD index (before update)
      const result = await this.plugin.searchService.searchV3([operation]);

      // If found in old index, pattern was already present (not new)
      if (result.conditionResults.length > 0) {
        logger.log(
          `Pattern already existed for ${file.name}, skipping trigger (found ${result.conditionResults.length} results)`
        );
        return false;
      }

      // Not found in old index, this is a newly added pattern
      return true;
    } catch (error) {
      logger.error('Error checking if pattern is newly added:', error);
      // On error, trigger anyway to be safe
      return true;
    }
  }

  /**
   * Run a user-defined command in a new conversation (vault triggers and run-links).
   */
  private async runNewConversationFromUserDefinedCommand(params: {
    command: IVersionedUserDefinedCommand;
    intentQuery: string;
    sourceFileBasename?: string;
  }): Promise<void> {
    const command = params.command;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const conversationsFolder = `${this.plugin.settings.stewardFolder}/Conversations`;
    const conversationTitle = `${command.normalized.command_name}-${timestamp}`;
    const conversationPath = `${conversationsFolder}/${conversationTitle}.md`;

    const buildNoticeFragment = (message: string): DocumentFragment => {
      const noticeEl = document.createDocumentFragment();
      const text = noticeEl.createEl('span');
      text.textContent = message;

      noticeEl.createEl('br');

      const link = noticeEl.createEl('a', {
        text: i18next.t('trigger.openConversation'),
        href: '#',
      });
      link.addEventListener('click', async e => {
        e.preventDefault();

        await this.plugin.openChat({ revealLeaf: true });

        const leaf = await this.plugin.getChatLeaf();
        const view = leaf.view;

        if (view instanceof ChatView) {
          await view.openExistingConversation(conversationPath);
        }
      });

      return noticeEl;
    };
    try {
      const folderExists = this.plugin.app.vault.getFolderByPath(conversationsFolder);
      if (!folderExists) {
        await this.plugin.app.vault.createFolder(conversationsFolder);
      }

      const frontmatterLines = [
        '---',
        `model: ${command.normalized.model || this.plugin.settings.llm.chat.model}`,
        `trigger: ${command.normalized.command_name}`,
      ];
      if (params.sourceFileBasename !== undefined) {
        frontmatterLines.push(`source_file: ${params.sourceFileBasename}`);
      }
      frontmatterLines.push(
        `created: ${new Date().toISOString()}`,
        `lang: ${getLanguage()}`,
        `indicator_text: ${t('conversation.planning')}`,
        '---',
        ''
      );

      const frontmatter = frontmatterLines.join('\n');

      await this.plugin.app.vault.create(conversationPath, frontmatter);

      new Notice(
        buildNoticeFragment(
          i18next.t('trigger.executing', { commandName: command.normalized.command_name })
        ),
        10000
      );

      await this.plugin.commandProcessorService.commandProcessor.processIntents({
        title: conversationTitle,
        intents: [
          {
            type: command.normalized.command_name,
            query: params.intentQuery,
          },
        ],
      });

      const leaf = await this.plugin.getChatLeaf();
      if (leaf.view instanceof ChatView && !leaf.view.isVisible(conversationPath)) {
        const lastResult =
          this.plugin.commandProcessorService.commandProcessor.getLastResult(conversationTitle);
        const completionMessageKey =
          lastResult?.status === IntentResultStatus.NEEDS_CONFIRMATION
            ? 'trigger.needsConfirmation'
            : 'trigger.executed';

        new Notice(
          buildNoticeFragment(
            i18next.t(completionMessageKey, {
              commandName: command.normalized.command_name,
            })
          ),
          10000
        );
      }
    } catch (error) {
      const leaf = await this.plugin.getChatLeaf();
      if (leaf.view instanceof ChatView && !leaf.view.isVisible(conversationPath)) {
        new Notice(
          buildNoticeFragment(
            i18next.t('trigger.executionFailed', {
              commandName: command.normalized.command_name,
              error: error instanceof Error ? error.message : String(error),
            })
          ),
          10000
        );
      }
      logger.error(
        `Error executing trigger for command ${command.normalized.command_name}:`,
        error
      );
    }
  }

  /**
   * Execute from a clickable run-link in markdown (see RunPostProcessor).
   */
  public async executeClickCommand(params: { commandName: string; query?: string }): Promise<void> {
    if (!this.hasCommand(params.commandName)) {
      new Notice(
        i18next.t('trigger.run.unknownCommand', { commandName: params.commandName }),
        7000
      );
      return;
    }

    const command = this.userDefinedCommands.get(params.commandName);
    if (!command) {
      return;
    }

    const queryTrimmed = params.query?.trim() ?? '';

    await this.runNewConversationFromUserDefinedCommand({
      command,
      intentQuery: queryTrimmed,
    });
  }

  /**
   * Execute a vault-event triggered command on a specific file.
   */
  private async executeTrigger(command: IVersionedUserDefinedCommand, file: TFile): Promise<void> {
    await this.runNewConversationFromUserDefinedCommand({
      command,
      intentQuery: `__file:${file.name}__`,
      sourceFileBasename: file.name,
    });
  }

  /**
   * Check and execute triggers for a file event
   */
  private async checkAndExecuteTriggers(
    file: TFile,
    event: 'create' | 'modify' | 'delete'
  ): Promise<void> {
    const conversationsPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const triggeredPath = `${this.plugin.settings.stewardFolder}/Triggered`;

    // Don't trigger on command files, conversation files, or triggered conversation files
    if (
      this.isCommandFile(file) ||
      file.path.startsWith(conversationsPath) ||
      file.path.startsWith(triggeredPath)
    ) {
      return;
    }

    for (const [commandName, command] of this.userDefinedCommands.entries()) {
      if (!command.normalized.enabled) {
        continue;
      }
      if (!command.normalized.triggers || command.normalized.triggers.length === 0) {
        continue;
      }

      for (const trigger of command.normalized.triggers) {
        // First, check if current state matches the trigger condition (cheaper operation than the searchV3 below)
        const matches = await this.evaluateTriggerCondition({ file, event, trigger });
        if (!matches) {
          continue; // Current state doesn't match, skip
        }

        // For modify events, check if this is a newly added pattern
        if (event === 'modify') {
          const isNewPattern = await this.isNewlyAddedPattern({ file, trigger });
          if (!isNewPattern) {
            continue; // Pattern already existed, skip
          }
        }

        // All conditions met, execute trigger
        logger.log(
          `Trigger matched for command: ${commandName}, event: ${event}, file: ${file.name}`
        );
        await this.executeTrigger(command, file);
        // Only execute once per command per event
        break;
      }
    }
  }

  /**
   * Get all user-defined command names for autocomplete
   */
  public getCommandNames(): string[] {
    return Array.from(this.userDefinedCommands.entries())
      .filter(([_, command]) => command.normalized.enabled && !command.isHidden())
      .map(([commandName, _]) => commandName);
  }

  /**
   * User-defined commands that are enabled (v2: YAML `enabled` or note frontmatter; v1: note only).
   */
  public getEnabledCommandCatalog(): CommandCatalog[] {
    const catalog: CommandCatalog[] = [];
    for (const [commandName, command] of this.userDefinedCommands.entries()) {
      if (!command.normalized.enabled) {
        continue;
      }
      const entry: CommandCatalog = {
        name: commandName,
        path: command.normalized.file_path,
      };
      const description = command.normalized.description?.trim();
      if (description) {
        entry.description = description;
      }
      catalog.push(entry);
    }
    catalog.sort((a, b) => a.name.localeCompare(b.name));
    return catalog;
  }

  /**
   * Process a user-defined command with user input
   */
  private async processUserDefinedCommand(
    commandName: string,
    userInput: string,
    conversationTitle?: string
  ): Promise<Intent[] | null> {
    const command = this.userDefinedCommands.get(commandName);

    if (!command) {
      return null;
    }

    if (!command.normalized.enabled) {
      return null;
    }

    // Extract fileName from userInput if present (format: __file:filename.md__)
    const fileNameMatch = userInput.match(/__file:([^_]+)__/);
    const fileName = fileNameMatch ? fileNameMatch[1] : '';
    // Remove the fileName marker from userInput
    const cleanedUserInput = userInput.replace(/__file:[^_]+__/g, '').trim();

    const steps: Intent[] = [];
    for (const step of command.normalized.steps) {
      if (!evaluateStepWhen(step.when, { cleanedUserInput })) {
        logger.warn(`Step "${step.query}" is skipped, condition doesn't match`, { step });
        continue;
      }

      const query = await this.expandAuthoredString(step.query, {
        fileName,
        cleanedUserInput,
        conversationTitle,
      });

      const model = step.model || command.normalized.model;

      let systemPrompts: string[] | undefined;
      if (step.system_prompt && step.system_prompt.length > 0) {
        systemPrompts = await Promise.all(
          step.system_prompt.map(prompt =>
            this.expandAuthoredString(prompt, {
              fileName,
              cleanedUserInput,
              conversationTitle,
            })
          )
        );
      }

      steps.push({
        type: step.name ?? '',
        systemPrompts,
        query,
        model,
        no_confirm: step.no_confirm,
        tools: command.normalized.tools,
      });
    }

    if (steps.length === 0) {
      return null;
    }

    return steps;
  }

  /**
   * Expand `$...` placeholders, then Mustache `{{...}}` when `conversationTitle` is set (chat / UDC with title).
   */
  private async expandAuthoredString(
    content: string,
    params: {
      fileName: string;
      cleanedUserInput: string;
      conversationTitle?: string;
    }
  ): Promise<string> {
    let out = this.replacePlaceholders(content, {
      fileName: params.fileName,
      userInput: params.cleanedUserInput,
    });
    if (params.conversationTitle) {
      const ctx = this.buildUdcTemplateContext({
        fileName: params.fileName,
        userInput: params.cleanedUserInput,
      });
      out = await this.renderMustacheTemplate(out, ctx);
    }
    return out;
  }

  private async renderMustacheTemplate(
    template: string,
    view: UdcTemplateContext
  ): Promise<string> {
    const mustache = await getBundledLib('mustache');
    return mustache.render(template, view, undefined, {
      escape: (text: string) => String(text),
    });
  }

  /**
   * @public for tests — builds Mustache context for a conversation turn.
   */
  public buildUdcTemplateContext(options: {
    fileName: string;
    userInput: string;
  }): UdcTemplateContext {
    return {
      from_user: options.userInput,
      file_name: options.fileName,
      steward: this.plugin.settings.stewardFolder,
      active_file: this.plugin.app.workspace.getActiveFile()?.path ?? '',
    };
  }

  /**
   * Check if a command name exists
   */
  public hasCommand(commandName: string): boolean {
    const cmd = this.userDefinedCommands.get(commandName);
    return cmd !== undefined && cmd.normalized.enabled;
  }

  /**
   * V2: normalized root `cli` for a command, if set.
   */
  public getCommandCli(commandName: string): NormalizedUserDefinedCommand['cli'] | undefined {
    const cmd = this.userDefinedCommands.get(commandName);
    if (!cmd || !cmd.normalized.enabled) {
      return undefined;
    }
    return cmd.normalized.cli;
  }

  /**
   * V2: normalized root `cli.shell`, if set (shell-style UDCs).
   */
  public getCommandCliShell(commandName: string): string | undefined {
    const shell = this.getCommandCli(commandName)?.shell?.trim();
    if (shell) {
      return shell;
    }
    return undefined;
  }

  /**
   * Recursively expand a list of CommandIntent, flattening user-defined commands and detecting cycles
   * Processes wikilinks in system prompts after expansion
   */
  public async expandUserDefinedCommandIntents(
    intents: Intent | Intent[],
    userInput = '',
    visited: Set<string> = new Set(),
    conversationTitle?: string
  ): Promise<Intent[]> {
    const expanded: Intent[] = [];

    intents = Array.isArray(intents) ? intents : [intents];

    for (const intent of intents) {
      if (!this.hasCommand(intent.type)) {
        expanded.push(intent);
        continue;
      }

      if (visited.has(intent.type)) {
        // Check if this is a built-in command
        const isBuiltInCommand = this.commandProcessorService.isBuiltInCommand(intent.type);

        // Only throw cycle error if it's not a built-in command
        if (!isBuiltInCommand) {
          throw new Error(`Cycle detected in user-defined commands: ${intent.type}`);
        }

        expanded.push(intent);
        continue;
      }

      visited.add(intent.type);
      const subIntents = await this.processUserDefinedCommand(
        intent.type,
        intent.query || userInput,
        conversationTitle
      );
      if (subIntents) {
        const expandedSubIntents = await this.expandUserDefinedCommandIntents(
          subIntents,
          userInput,
          visited,
          conversationTitle
        );
        expanded.push(...expandedSubIntents);
      }
      visited.delete(intent.type);
    }

    // System prompts are kept as-is (with wikilink references unresolved)
    // They will be resolved at execution time in SuperAgent
    return expanded;
  }

  /**
   * Replaces supported UDC placeholders in authored strings (queries/system prompts):
   * `$steward`, `$active_file`, `$file_name`, `$from_user`.
   */
  public replacePlaceholders(
    content: string,
    /** Replacement values */
    options: { fileName?: string; userInput?: string } = {}
  ): string {
    if (content.length === 0) {
      return content;
    }

    const stewardFolder = this.plugin.settings.stewardFolder;
    const activeFilePath = this.plugin.app.workspace.getActiveFile()?.path ?? '';
    let replaced = content;

    if (options.fileName && replaced.includes('$file_name')) {
      replaced = replaced.replace(/\$file_name/g, options.fileName);
    }

    if (options.userInput && replaced.includes('$from_user')) {
      replaced = replaced.replace(/\$from_user/g, options.userInput);
    }

    if (replaced.includes('$steward')) {
      replaced = replaced.replace(/\$steward/g, stewardFolder);
    }

    if (replaced.includes('$active_file')) {
      replaced = replaced.replace(/\$active_file/g, activeFilePath);
    }

    return replaced;
  }

  /**
   * Process wikilinks in system prompts
   * Only processes string-based prompts
   * @param systemPrompts Array of system prompt strings
   * @returns Processed system prompts with wikilinks resolved and placeholders replaced
   */
  public async processSystemPromptsWikilinks(systemPrompts: string[]): Promise<string[]> {
    if (systemPrompts.length === 0) {
      return systemPrompts;
    }

    const processedPrompts = await Promise.all(
      systemPrompts.map(prompt =>
        this.plugin.noteContentService.processWikilinksInContent(prompt, 2)
      )
    );

    return processedPrompts.map(prompt => this.replacePlaceholders(prompt));
  }
}
