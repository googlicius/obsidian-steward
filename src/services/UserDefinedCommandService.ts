import { normalizePath, TFile } from 'obsidian';
import { logger } from 'src/utils/logger';
import { CommandIntent } from 'src/types/types';
import * as yaml from 'js-yaml';
import type StewardPlugin from 'src/main';
import { COMMAND_PREFIXES } from 'src/constants';
import { SearchOperationV2 } from 'src/solutions/commands/handlers/SearchCommandHandler/zSchemas';
import { SystemPromptItem } from 'src/utils/SystemPromptModifier';

/**
 * Represents a command within a user-defined command sequence
 */
interface UserDefinedCommandStep {
  name: string;
  system_prompt?: (string | SystemPromptItem)[];
  query: string;
  model?: string;
}

/**
 * Represents a trigger condition for automated command execution
 */
export interface TriggerCondition {
  // Event types to watch
  events: ('create' | 'modify' | 'delete')[];

  // Folder path(s) to watch (optional)
  folders?: string[];

  // Pattern matching (all conditions must be met)
  // Keys can be 'tags' for tags, 'content' for regex, or any frontmatter property name
  patterns?: Record<string, string | string[]>;
}

/**
 * Represents a user-defined command definition
 */
export interface UserDefinedCommand {
  command_name: string;
  query_required?: boolean;
  commands: UserDefinedCommandStep[];
  file_path: string;
  model?: string;
  triggers?: TriggerCondition[];
}

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
   */
  private async loadCommandFromFile(file: TFile): Promise<void> {
    try {
      // First, remove any existing commands from this file
      this.removeCommandsFromFile(file.path);

      const content = await this.plugin.app.vault.cachedRead(file);

      // Extract YAML blocks from the content
      const yamlBlocks = await this.extractYamlBlocks(content);

      for (const yamlContent of yamlBlocks) {
        try {
          const commandDefinition = yaml.load(yamlContent) as UserDefinedCommand;

          // Add file path to the command definition
          commandDefinition.file_path = file.path;

          if (this.validateCommandDefinition(commandDefinition)) {
            this.userDefinedCommands.set(commandDefinition.command_name, commandDefinition);
            logger.log(`Loaded user-defined command: ${commandDefinition.command_name}`);
          }
        } catch (yamlError) {
          logger.error(`Invalid YAML in file ${file.path}:`, yamlError);
        }
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
   * Validate a command definition
   */
  private validateCommandDefinition(command: UserDefinedCommand): boolean {
    if (!command.command_name || typeof command.command_name !== 'string') {
      logger.error('Invalid command: missing or invalid command_name');
      return false;
    }

    if (!Array.isArray(command.commands) || command.commands.length === 0) {
      logger.error(`Invalid command ${command.command_name}: missing or empty commands array`);
      return false;
    }

    if ('query_required' in command && typeof command.query_required !== 'boolean') {
      logger.error(`Invalid command ${command.command_name}: query_required must be a boolean`);
      return false;
    }

    // Validate the model field if present
    if ('model' in command && typeof command.model !== 'string') {
      logger.error(`Invalid command ${command.command_name}: model must be a string`);
      return false;
    }

    // Validate triggers if present
    if ('triggers' in command) {
      if (!Array.isArray(command.triggers)) {
        logger.error(`Invalid command ${command.command_name}: triggers must be an array`);
        return false;
      }

      for (const trigger of command.triggers) {
        if (!this.validateTriggerCondition(command.command_name, trigger)) {
          return false;
        }
      }
    }

    for (const step of command.commands) {
      if (!step.name || typeof step.name !== 'string') {
        logger.error(`Invalid command ${command.command_name}: step missing name`);
        return false;
      }

      // Check system_prompt can be either a string or an array (of strings or modification objects)
      if ('system_prompt' in step) {
        if (!Array.isArray(step.system_prompt) && typeof step.system_prompt !== 'string') {
          logger.error(
            `Invalid command ${command.command_name}: system_prompt must be an array or string`
          );
          return false;
        }

        // Validate array items if it's an array
        if (Array.isArray(step.system_prompt)) {
          for (const item of step.system_prompt) {
            if (typeof item !== 'string' && typeof item !== 'object') {
              logger.error(
                `Invalid command ${command.command_name}: system_prompt array items must be strings or modification objects`
              );
              return false;
            }

            // Validate modification object structure
            if (typeof item === 'object') {
              if (!('mode' in item) || !['modify', 'remove', 'add'].includes(item.mode)) {
                logger.error(
                  `Invalid command ${command.command_name}: system_prompt modification must have valid mode (modify, remove, or add)`
                );
                return false;
              }

              // Validate mode-specific requirements
              if (item.mode === 'modify' && (!item.pattern || !item.replacement)) {
                logger.error(
                  `Invalid command ${command.command_name}: system_prompt modify mode requires pattern and replacement`
                );
                return false;
              }

              if (item.mode === 'remove' && !item.pattern) {
                logger.error(
                  `Invalid command ${command.command_name}: system_prompt remove mode requires pattern`
                );
                return false;
              }

              if (item.mode === 'add' && !item.content) {
                logger.error(
                  `Invalid command ${command.command_name}: system_prompt add mode requires content`
                );
                return false;
              }
            }
          }
        }
      }

      if (!step.query || typeof step.query !== 'string') {
        logger.error(`Invalid command ${command.command_name}: step missing query`);
        return false;
      }

      // Validate the step model field if present
      if ('model' in step && typeof step.model !== 'string') {
        logger.error(`Invalid command ${command.command_name}: step model must be a string`);
        return false;
      }
    }

    return true;
  }

  /**
   * Validate a trigger condition
   */
  private validateTriggerCondition(commandName: string, trigger: TriggerCondition): boolean {
    if (!Array.isArray(trigger.events) || trigger.events.length === 0) {
      logger.error(`Invalid command ${commandName}: trigger must have non-empty events array`);
      return false;
    }

    const validEvents = ['create', 'modify', 'delete'];
    for (const event of trigger.events) {
      if (!validEvents.includes(event)) {
        logger.error(
          `Invalid command ${commandName}: invalid event type "${event}". Must be one of: ${validEvents.join(', ')}`
        );
        return false;
      }
    }

    if (trigger.folders !== undefined && !Array.isArray(trigger.folders)) {
      logger.error(`Invalid command ${commandName}: trigger folders must be an array`);
      return false;
    }

    if (trigger.patterns) {
      if (typeof trigger.patterns !== 'object') {
        logger.error(`Invalid command ${commandName}: trigger patterns must be an object`);
        return false;
      }

      // Validate each pattern
      for (const [key, value] of Object.entries(trigger.patterns)) {
        if (typeof value !== 'string' && !Array.isArray(value)) {
          logger.error(
            `Invalid command ${commandName}: trigger pattern "${key}" must be a string or array`
          );
          return false;
        }

        // Validate regex pattern for content
        if (key === 'content') {
          const pattern = Array.isArray(value) ? value[0] : value;
          try {
            new RegExp(pattern);
          } catch (e) {
            logger.error(
              `Invalid command ${commandName}: trigger pattern "content" is not a valid regex: ${e.message}`
            );
            return false;
          }
        }
      }
    }

    return true;
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
        filenames: [file.basename], // Search by filename without extension
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
    try {
      // Generate unique conversation note title
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const conversationsFolder = `${this.plugin.settings.stewardFolder}/Conversations`;
      const conversationTitle = `${command.command_name}-${timestamp}`;
      const conversationPath = `${conversationsFolder}/${conversationTitle}.md`;

      logger.log(`Executing triggered command: ${command.command_name} for file: ${file.name}`);

      // Ensure conversations folder exists
      const folderExists = this.plugin.app.vault.getFolderByPath(conversationsFolder);
      if (!folderExists) {
        await this.plugin.app.vault.createFolder(conversationsFolder);
      }

      // Create the conversation note
      const frontmatter = [
        '---',
        `trigger: ${command.command_name}`,
        `source_file: ${file.name}`,
        `created: ${new Date().toISOString()}`,
        '---',
        '',
      ].join('\n');

      await this.plugin.app.vault.create(conversationPath, frontmatter);

      await this.plugin.commandProcessorService.commandProcessor.processCommands({
        title: conversationTitle,
        commands: [
          {
            commandType: command.command_name,
            query: `__file:${file.name}__`,
          },
        ],
      });
    } catch (error) {
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
        // First, check if current state matches the trigger condition (cheap operation)
        const matches = await this.evaluateTriggerCondition({ file, event, trigger });
        if (!matches) {
          continue; // Current state doesn't match, skip
        }

        // For modify events, check if this is a newly added pattern (expensive search operation)
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
    return Array.from(this.userDefinedCommands.keys());
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
