import { getLanguage, normalizePath, Notice, TFile } from 'obsidian';
import { logger } from 'src/utils/logger';
import { CommandIntent } from 'src/types/types';
import * as yaml from 'js-yaml';
import type StewardPlugin from 'src/main';
import { COMMAND_PREFIXES } from 'src/constants';
import { SearchOperationV2 } from 'src/solutions/commands/handlers/SearchCommandHandler/zSchemas';
import { SystemPromptItem } from 'src/utils/SystemPromptModifier';
import { StewardChatView } from 'src/views/StewardChatView';
import i18next from 'i18next';
import { z } from 'zod';

/**
 * Represents a user-defined command definition
 */
export interface UserDefinedCommand {
  command_name: string;
  query_required?: boolean;
  commands: Array<{
    name: string;
    system_prompt?: (string | SystemPromptItem)[];
    query: string;
    model?: string;
    no_confirm?: boolean;
  }>;
  file_path: string;
  model?: string;
  hidden?: boolean;
  triggers?: Array<{
    // Event types to watch
    events: ('create' | 'modify' | 'delete')[];

    // Folder path(s) to watch (optional)
    folders?: string[];

    // Pattern matching (all conditions must be met)
    // Keys can be 'tags' for tags, 'content' for regex, or any frontmatter property name
    patterns?: Record<string, string | string[]>;
  }>;
}

type TriggerCondition = NonNullable<UserDefinedCommand['triggers']>[number];

/**
 * Zod schema for SystemPromptModification
 */
const systemPromptModificationSchema = z.object({
  mode: z.enum(['modify', 'remove', 'add']),
  pattern: z.string().optional(),
  replacement: z.string().optional(),
  content: z.string().optional(),
  matchType: z.enum(['exact', 'partial', 'regex']).optional(),
});

/**
 * Zod schema for SystemPromptItem
 */
const systemPromptItemSchema = z.union([z.string(), systemPromptModificationSchema]);

/**
 * Validation refinement for SystemPromptModification based on mode
 */
const validateSystemPromptModification = (
  item: z.infer<typeof systemPromptModificationSchema>
): boolean => {
  if (item.mode === 'modify') {
    return !!item.pattern && !!item.replacement;
  }
  if (item.mode === 'remove') {
    return !!item.pattern;
  }
  if (item.mode === 'add') {
    return !!item.content;
  }
  return false;
};

/**
 * Zod schema for UserDefinedCommandStep
 */
const userDefinedCommandStepSchema = z.object({
  name: z.string().min(1, 'Command name is required'),
  system_prompt: z
    .array(systemPromptItemSchema)
    .optional()
    .refine(
      val => {
        if (!val) return true;
        return val.every(item => {
          if (typeof item === 'string') return true;
          return validateSystemPromptModification(item);
        });
      },
      {
        message:
          'system_prompt modification objects must have valid mode-specific fields (modify: pattern & replacement, remove: pattern, add: content)',
      }
    ),
  query: z.string().min(1, 'Step query is required'),
  model: z.string().optional(),
  no_confirm: z.boolean().optional(),
});

/**
 * Zod schema for TriggerCondition
 */
const triggerConditionSchema = z
  .object({
    events: z
      .array(z.enum(['create', 'modify', 'delete']))
      .min(1, 'At least one event is required'),
    folders: z.array(z.string()).optional(),
    patterns: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  })
  .refine(
    data => {
      // Validate regex pattern for content
      if (data.patterns?.content) {
        const pattern = Array.isArray(data.patterns.content)
          ? data.patterns.content[0]
          : data.patterns.content;
        try {
          new RegExp(pattern);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: 'trigger pattern "content" must be a valid regex',
    }
  );

/**
 * Zod schema for UserDefinedCommand
 */
const userDefinedCommandSchema = z.object({
  command_name: z
    .string()
    .min(1, 'Command name is required')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Command name must only contain alphanumeric characters, hyphens, and underscores (no spaces or special characters)'
    ),
  query_required: z.boolean().optional(),
  commands: z.array(userDefinedCommandStepSchema).min(1, 'At least one command step is required'),
  file_path: z.string(),
  model: z.string().optional(),
  hidden: z.boolean().optional(),
  triggers: z.array(triggerConditionSchema).optional(),
});

export class UserDefinedCommandService {
  private static instance: UserDefinedCommandService | null = null;
  public userDefinedCommands: Map<string, UserDefinedCommand> = new Map();
  private commandFolder: string;

  // Track files pending trigger checks (waiting for metadata cache update)
  private pendingTriggerChecks: Map<string, 'create' | 'modify' | 'delete'> = new Map();

  private constructor(private plugin: StewardPlugin) {
    this.commandFolder = `${this.plugin.settings.stewardFolder}/Commands`;
    this.initialize();
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
   * Load all command definitions from the Commands folder
   */
  private async loadAllCommands(): Promise<void> {
    const folder = this.plugin.app.vault.getFolderByPath(this.commandFolder);

    if (!folder) {
      return;
    }

    // Clear existing commands
    this.userDefinedCommands.clear();

    // Process all files in the folder
    for (const file of folder.children) {
      if (file instanceof TFile && file.extension === 'md') {
        await this.loadCommandFromFile(file);
      }
    }

    logger.log(`Loaded ${this.userDefinedCommands.size} user-defined commands`);
  }

  /**
   * Load command definition from a file
   * @param file The file to load commands from
   * @param shouldRenderErrors Whether to render validation errors (only on modify events)
   */
  private async loadCommandFromFile(file: TFile, shouldRenderErrors = false): Promise<void> {
    try {
      // First, remove any existing commands from this file
      this.removeCommandsFromFile(file.path);

      const content = await this.plugin.app.vault.cachedRead(file);

      // Extract YAML blocks from the content
      const yamlBlocks = await this.extractYamlBlocks(content);

      const validationErrors: Array<{
        commandName: string;
        errors: string[];
      }> = [];

      for (const yamlContent of yamlBlocks) {
        try {
          const commandDefinition = yaml.load(yamlContent) as UserDefinedCommand;

          // Add file path to the command definition
          commandDefinition.file_path = file.path;

          const validation = this.validateCommandDefinitionWithErrors(commandDefinition);

          if (validation.isValid) {
            this.userDefinedCommands.set(commandDefinition.command_name, commandDefinition);
            logger.log(`Loaded user-defined command: ${commandDefinition.command_name}`);
          } else {
            validationErrors.push({
              commandName: commandDefinition.command_name || 'unknown',
              errors: validation.errors,
            });
          }
        } catch (yamlError) {
          const errorMsg = yamlError instanceof Error ? yamlError.message : String(yamlError);
          validationErrors.push({
            commandName: 'unknown',
            errors: [i18next.t('validation.yamlError'), errorMsg],
          });
          logger.error(`Invalid YAML in file ${file.path}:`, yamlError);
        }
      }

      // Render validation result on modify events (errors or success message)
      if (shouldRenderErrors) {
        await this.renderValidationErrors(file, validationErrors);
      }
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
      if (command.file_path === filePath) {
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
   * Extract YAML blocks from markdown content
   */
  private async extractYamlBlocks(content: string): Promise<string[]> {
    const yamlBlocks: string[] = [];
    const yamlRegex = /```yaml\s*([\s\S]*?)\s*```/gi;

    let match;
    while ((match = yamlRegex.exec(content)) !== null) {
      if (match[1]) {
        yamlBlocks.push(match[1]);
      }
    }

    return yamlBlocks;
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

  /**
   * Validate a command definition and return detailed errors
   */
  private validateCommandDefinitionWithErrors(command: UserDefinedCommand): {
    isValid: boolean;
    errors: string[];
  } {
    try {
      userDefinedCommandSchema.parse(command);
      return { isValid: true, errors: [] };
    } catch (error) {
      const errors: string[] = [];
      if (error instanceof z.ZodError) {
        const commandName = command.command_name || 'unknown';
        logger.error(`Invalid command ${commandName}:`);

        const addError = (path: string, message: string) => {
          const errorMsg = `${path}: ${message}`;
          errors.push(errorMsg);
          logger.error(`  - ${errorMsg}`);
        };

        for (const issue of error.errors) {
          // Handle invalid_union errors - extract nested errors
          if (issue.code === 'invalid_union') {
            for (const unionError of issue.unionErrors) {
              for (const nestedIssue of unionError.issues) {
                const path = nestedIssue.path.join('.');
                addError(path, nestedIssue.message);
              }
            }
          } else {
            // Handle regular errors
            const path = issue.path.join('.');
            addError(path, issue.message);
          }
        }
      } else {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(errorMsg);
        logger.error('Invalid command definition:', error);
      }
      return { isValid: false, errors };
    }
  }

  /**
   * Render validation errors or success message in a dedicated note
   */
  private async renderValidationErrors(
    sourceFile: TFile,
    validationErrors: Array<{
      commandName: string;
      errors: string[];
    }>
  ): Promise<void> {
    try {
      const stewardFolder = this.plugin.settings.stewardFolder;
      const validationNotePath = `${stewardFolder}/UDC-validation-errors.md`;

      const errorDescription = i18next.t('validation.errorDescription');

      let errorContent = '';
      errorContent += `**Source file:** [[${sourceFile.basename}]]\n\n`;
      errorContent += '```stw-artifact\n';
      errorContent += `**Last updated:** ${new Date().toLocaleString()}\n`;
      errorContent += '```\n\n';
      errorContent += `---\n\n`;

      if (validationErrors.length === 0) {
        // No errors - show success message
        const successMessage = i18next.t('validation.successMessage');
        const successCallout = this.plugin.noteContentService.formatCallout(
          successMessage,
          'success'
        );
        errorContent += successCallout;
      } else {
        // Has errors - show error details
        errorContent += `${errorDescription}\n\n`;

        for (const errorInfo of validationErrors) {
          const commandError = i18next.t('validation.commandError', {
            commandName: errorInfo.commandName,
          });
          errorContent += `**${commandError}**\n\n`;

          // Format errors as callout
          const errorList = errorInfo.errors.map(err => `- ${err}`).join('\n');
          const errorCallout = this.plugin.noteContentService.formatCallout(errorList, 'error');
          errorContent += errorCallout + '\n';
        }

        errorContent += `---\n\n`;
      }

      // Check if the validation note already exists
      const existingFile = this.plugin.app.vault.getFileByPath(validationNotePath);

      if (existingFile) {
        // Update existing file
        await this.plugin.app.vault.modify(existingFile, errorContent);
      } else {
        // Create new file
        await this.plugin.app.vault.create(validationNotePath, errorContent);
      }

      // Only show notice if there are errors
      if (validationErrors.length > 0) {
        const leaf = this.plugin.getChatLeaf();
        if (leaf.view instanceof StewardChatView && !leaf.view.isVisible(validationNotePath)) {
          // Show notice with link to open the chat and view errors
          const noticeEl = document.createDocumentFragment();
          const text = noticeEl.createEl('span');
          text.textContent = i18next.t('validation.errorDetected', {
            fileName: sourceFile.basename,
          });

          // Add line break
          noticeEl.createEl('br');

          const link = noticeEl.createEl('a', {
            text: i18next.t('validation.openValidationNote'),
            href: '#',
          });
          link.addEventListener('click', async e => {
            e.preventDefault();

            // Open the chat
            await this.plugin.openChat({ revealLeaf: true });

            // Get the chat view and open the validation note
            const leaf = this.plugin.getChatLeaf();
            const view = leaf.view;

            if (view instanceof StewardChatView) {
              await view.openExistingConversation(validationNotePath);
            }
          });

          new Notice(noticeEl, 10000);
        }
      }
    } catch (error) {
      logger.error('Error rendering validation errors:', error);
    }
  }

  /**
   * Handle file modification events
   */
  private async handleFileModification(file: TFile): Promise<void> {
    if (this.isCommandFile(file)) {
      await this.loadCommandFromFile(file, true); // Render errors on modify
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
    return file.path.startsWith(this.commandFolder) && file.extension === 'md';
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
   * Execute a triggered command
   */
  private async executeTrigger(command: UserDefinedCommand, file: TFile): Promise<void> {
    // Generate unique conversation note title
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const conversationsFolder = `${this.plugin.settings.stewardFolder}/Conversations`;
    const conversationTitle = `${command.command_name}-${timestamp}`;
    const conversationPath = `${conversationsFolder}/${conversationTitle}.md`;
    logger.log(`Executing triggered command: ${command.command_name} for file: ${file.name}`);

    const getNoticeEl = (message: string): DocumentFragment => {
      // Show notice with link to the conversation note
      const noticeEl = document.createDocumentFragment();
      const text = noticeEl.createEl('span');
      text.textContent = message;

      // Add line break
      noticeEl.createEl('br');

      const link = noticeEl.createEl('a', {
        text: i18next.t('trigger.openConversation'),
        href: '#',
      });
      link.addEventListener('click', async e => {
        e.preventDefault();

        // Open the chat
        await this.plugin.openChat({ revealLeaf: true });

        // Get the chat view and open the conversation
        const leaf = this.plugin.getChatLeaf();
        const view = leaf.view;

        if (view instanceof StewardChatView) {
          await view.openExistingConversation(conversationPath);
        }
      });

      return noticeEl;
    };

    try {
      // Ensure conversations folder exists
      const folderExists = this.plugin.app.vault.getFolderByPath(conversationsFolder);
      if (!folderExists) {
        await this.plugin.app.vault.createFolder(conversationsFolder);
      }

      // Create the conversation note
      const frontmatter = [
        '---',
        `model: ${command.model || this.plugin.settings.llm.chat.model}`,
        `trigger: ${command.command_name}`,
        `source_file: ${file.name}`,
        `created: ${new Date().toISOString()}`,
        `lang: ${getLanguage()}`,
        '---',
        '',
      ].join('\n');

      await this.plugin.app.vault.create(conversationPath, frontmatter);

      new Notice(
        getNoticeEl(i18next.t('trigger.executing', { commandName: command.command_name })),
        10000
      );

      await this.plugin.commandProcessorService.commandProcessor.processCommands({
        title: conversationTitle,
        commands: [
          {
            commandType: command.command_name,
            query: `__file:${file.name}__`,
          },
        ],
      });

      // Show notice if the chat view is not visible
      const leaf = this.plugin.getChatLeaf();
      if (leaf.view instanceof StewardChatView && !leaf.view.isVisible(conversationPath)) {
        new Notice(
          getNoticeEl(i18next.t('trigger.executed', { commandName: command.command_name })),
          10000
        );
      }
    } catch (error) {
      const leaf = this.plugin.getChatLeaf();
      if (leaf.view instanceof StewardChatView && !leaf.view.isVisible(conversationPath)) {
        new Notice(
          getNoticeEl(
            i18next.t('trigger.executionFailed', {
              commandName: command.command_name,
              error: error instanceof Error ? error.message : String(error),
            })
          ),
          10000
        );
      }
      logger.error(`Error executing trigger for command ${command.command_name}:`, error);
    }
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
      if (!command.triggers || command.triggers.length === 0) {
        continue;
      }

      for (const trigger of command.triggers) {
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
      .filter(([_, command]) => !command.hidden)
      .map(([commandName, _]) => commandName);
  }

  /**
   * Process a user-defined command with user input
   */
  private processUserDefinedCommand(
    commandName: string,
    userInput: string
  ): CommandIntent[] | null {
    const command = this.userDefinedCommands.get(commandName);

    if (!command) {
      return null;
    }

    // Extract fileName from userInput if present (format: __file:filename.md__)
    const fileNameMatch = userInput.match(/__file:([^_]+)__/);
    const fileName = fileNameMatch ? fileNameMatch[1] : '';
    // Remove the fileName marker from userInput
    const cleanedUserInput = userInput.replace(/__file:[^_]+__/g, '').trim();

    // Convert the user-defined command steps to CommandIntent objects
    return command.commands.map(step => {
      // Replace placeholders with actual values
      let query = step.query;

      // Replace $file_name placeholder if fileName was extracted
      if (fileName) {
        query = query.replace(/\$file_name/g, fileName);
      }

      // Replace $from_user placeholder with cleaned user input
      query = query.replace(/\$from_user/g, cleanedUserInput);

      // Use step model if available, otherwise use command model
      const model = step.model || command.model;

      return {
        commandType: step.name,
        systemPrompts: step.system_prompt,
        query,
        model,
        no_confirm: step.no_confirm,
      };
    });
  }

  /**
   * Check if a command name exists
   */
  public hasCommand(commandName: string): boolean {
    return this.userDefinedCommands.has(commandName);
  }

  /**
   * Recursively expand a list of CommandIntent, flattening user-defined commands and detecting cycles
   */
  public expandUserDefinedCommandIntents(
    intents: CommandIntent[],
    userInput: string,
    visited: Set<string> = new Set()
  ): CommandIntent[] {
    const expanded: CommandIntent[] = [];

    for (const intent of intents) {
      if (!this.hasCommand(intent.commandType)) {
        expanded.push(intent);
        continue;
      }

      if (visited.has(intent.commandType)) {
        // Check if this is a built-in command
        const isBuiltInCommand = this.commandProcessorService.isBuiltInCommand(intent.commandType);

        // Only throw cycle error if it's not a built-in command
        if (!isBuiltInCommand) {
          throw new Error(`Cycle detected in user-defined commands: ${intent.commandType}`);
        }

        expanded.push(intent);
        continue;
      }

      visited.add(intent.commandType);
      const subIntents = this.processUserDefinedCommand(
        intent.commandType,
        intent.query || userInput
      );
      if (subIntents) {
        expanded.push(...this.expandUserDefinedCommandIntents(subIntents, userInput, visited));
      }
      visited.delete(intent.commandType);
    }

    return expanded;
  }
}
