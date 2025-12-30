import { getLanguage, normalizePath, Notice, TFile, parseYaml } from 'obsidian';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import { COMMAND_PREFIXES } from 'src/constants';
import { StewardChatView } from 'src/views/StewardChatView';
import i18next from 'i18next';
import { IVersionedUserDefinedCommand, TriggerCondition } from './versions/types';
import { loadUDCVersion } from './versions/loader';
import { Intent } from 'src/solutions/commands/types';
import { SearchOperationV2 } from 'src/solutions/commands/agents/handlers';

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

      // Only process the first YAML block as the command definition
      // Other YAML blocks are ignored (they may be examples or referenced content for system prompts)
      if (yamlBlocks.length === 0) {
        return;
      }

      const validationErrors: Array<{
        commandName: string;
        errors: string[];
      }> = [];

      // Process only the first YAML block
      const yamlContent = yamlBlocks[0];
      try {
        const rawData = parseYaml(yamlContent);

        // Load and validate using version-aware loader (async imports)
        const result = await loadUDCVersion(rawData, file.path);

        if (!result.success) {
          // Collect errors from parse function
          const commandName = rawData.command_name || 'unknown';
          validationErrors.push({
            commandName,
            errors: result.errors,
          });
        } else {
          // Successfully loaded - store the command
          const versionedCommand = result.command;
          this.userDefinedCommands.set(versionedCommand.normalized.command_name, versionedCommand);
          logger.log(
            `Loaded user-defined command: ${versionedCommand.normalized.command_name} (v${versionedCommand.getVersion()})`
          );
        }
      } catch (yamlError) {
        const errorMsg = yamlError instanceof Error ? yamlError.message : String(yamlError);
        validationErrors.push({
          commandName: 'unknown',
          errors: [i18next.t('validation.yamlError'), errorMsg],
        });
        logger.error(`Invalid YAML in file ${file.path}:`, yamlError);
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
  private async executeTrigger(command: IVersionedUserDefinedCommand, file: TFile): Promise<void> {
    // Generate unique conversation note title
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const conversationsFolder = `${this.plugin.settings.stewardFolder}/Conversations`;
    const conversationTitle = `${command.normalized.command_name}-${timestamp}`;
    const conversationPath = `${conversationsFolder}/${conversationTitle}.md`;
    logger.log(
      `Executing triggered command: ${command.normalized.command_name} for file: ${file.name}`
    );

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
        `model: ${command.normalized.model || this.plugin.settings.llm.chat.model}`,
        `trigger: ${command.normalized.command_name}`,
        `source_file: ${file.name}`,
        `created: ${new Date().toISOString()}`,
        `lang: ${getLanguage()}`,
        '---',
        '',
      ].join('\n');

      await this.plugin.app.vault.create(conversationPath, frontmatter);

      new Notice(
        getNoticeEl(
          i18next.t('trigger.executing', { commandName: command.normalized.command_name })
        ),
        10000
      );

      await this.plugin.commandProcessorService.commandProcessor.processIntents({
        title: conversationTitle,
        intents: [
          {
            type: command.normalized.command_name,
            query: `__file:${file.name}__`,
          },
        ],
      });

      // Show notice if the chat view is not visible
      const leaf = this.plugin.getChatLeaf();
      if (leaf.view instanceof StewardChatView && !leaf.view.isVisible(conversationPath)) {
        new Notice(
          getNoticeEl(
            i18next.t('trigger.executed', { commandName: command.normalized.command_name })
          ),
          10000
        );
      }
    } catch (error) {
      const leaf = this.plugin.getChatLeaf();
      if (leaf.view instanceof StewardChatView && !leaf.view.isVisible(conversationPath)) {
        new Notice(
          getNoticeEl(
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
      .filter(([_, command]) => !command.isHidden())
      .map(([commandName, _]) => commandName);
  }

  /**
   * Process a user-defined command with user input
   */
  private processUserDefinedCommand(commandName: string, userInput: string): Intent[] | null {
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
    return command.normalized.steps.map(step => {
      // Replace placeholders with actual values
      let query = step.query;

      // Replace $file_name placeholder if fileName was extracted
      if (fileName) {
        query = query.replace(/\$file_name/g, fileName);
      }

      // Replace $from_user placeholder with cleaned user input
      query = query.replace(/\$from_user/g, cleanedUserInput);

      // Use step model if available, otherwise use command model
      const model = step.model || command.normalized.model;

      return {
        type: step.name ?? '',
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
    intents: Intent | Intent[],
    userInput = '',
    visited: Set<string> = new Set()
  ): Intent[] {
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
      const subIntents = this.processUserDefinedCommand(intent.type, intent.query || userInput);
      if (subIntents) {
        expanded.push(...this.expandUserDefinedCommandIntents(subIntents, userInput, visited));
      }
      visited.delete(intent.type);
    }

    return expanded;
  }

  /**
   * Process wikilinks in system prompts
   * Only processes string-based prompts
   * @param systemPrompts Array of system prompt strings
   * @returns Processed system prompts with wikilinks resolved
   */
  public async processSystemPromptsWikilinks(systemPrompts: string[]): Promise<string[]> {
    if (systemPrompts.length === 0) {
      return systemPrompts;
    }

    return Promise.all(
      systemPrompts.map(prompt =>
        this.plugin.noteContentService.processWikilinksInContent(prompt, 2)
      )
    );
  }
}
