import { TFile } from 'obsidian';
import { logger } from 'src/utils/logger';
import { CommandIntent } from 'src/lib/modelfusion/extractions';
import * as yaml from 'js-yaml';

import type StewardPlugin from 'src/main';
import { COMMAND_PREFIXES } from 'src/constants';

/**
 * Represents a command within a user-defined command sequence
 */
interface UserDefinedCommandStep {
  name: string;
  system_prompt?: string[] | string;
  query: string;
  model?: string;
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
}

export class UserDefinedCommandService {
  private static instance: UserDefinedCommandService | null = null;
  public userDefinedCommands: Map<string, UserDefinedCommand> = new Map();
  private commandFolder: string;

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
            logger.log(
              `Loaded user-defined command: ${commandDefinition.command_name}, \n\nCommand Definition: \n${yamlContent}`
            );
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

    for (const step of command.commands) {
      if (!step.name || typeof step.name !== 'string') {
        logger.error(`Invalid command ${command.command_name}: step missing name`);
        return false;
      }

      // Check system_prompt can be either a string or an array
      if ('system_prompt' in step) {
        if (!Array.isArray(step.system_prompt) && typeof step.system_prompt !== 'string') {
          logger.error(
            `Invalid command ${command.command_name}: system_prompt must be an array or string`
          );
          return false;
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
   * Handle file modification events
   */
  private async handleFileModification(file: TFile): Promise<void> {
    if (this.isCommandFile(file)) {
      await this.loadCommandFromFile(file);
    }
  }

  /**
   * Handle file creation events
   */
  private async handleFileCreation(file: TFile): Promise<void> {
    if (this.isCommandFile(file)) {
      await this.loadCommandFromFile(file);
    }
  }

  /**
   * Handle file deletion events
   */
  private handleFileDeletion(file: TFile): void {
    if (this.isCommandFile(file)) {
      // Remove all commands associated with this file
      this.removeCommandsFromFile(file.path);
      logger.log(`Removed commands from deleted file: ${file.path}`);
    }
  }

  /**
   * Check if a file is a command file
   */
  private isCommandFile(file: TFile): boolean {
    return file.path.startsWith(this.commandFolder) && file.extension === 'md';
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

    // Convert the user-defined command steps to CommandIntent objects
    return command.commands.map(step => {
      // Replace $from_user placeholder with actual user input
      const query = step.query.replace('$from_user', userInput.trim());

      // Ensure systemPrompts is always an array
      let systemPrompts: string[] | undefined;

      if (step.system_prompt) {
        if (Array.isArray(step.system_prompt)) {
          systemPrompts = step.system_prompt;
        } else {
          // If it's a string, convert to an array with one element
          systemPrompts = [step.system_prompt];
        }
      }

      // Use step model if available, otherwise use command model
      const model = step.model || command.model;

      return {
        commandType: step.name,
        systemPrompts,
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
