import { TFile, TFolder } from 'obsidian';
import StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { CommandIntent } from 'src/lib/modelfusion/extractions';

/**
 * Represents a command within a user-defined command sequence
 */
interface UserDefinedCommandStep {
  name: string;
  system_prompt?: string[] | string;
  query: string;
}

/**
 * Represents a user-defined command definition
 */
export interface UserDefinedCommand {
  command_name: string;
  description?: string;
  query_required?: boolean;
  commands: UserDefinedCommandStep[];
  file_path: string;
}

export class UserDefinedCommandService {
  public userDefinedCommands: Map<string, UserDefinedCommand> = new Map();
  private commandFolder: string;

  constructor(private plugin: StewardPlugin) {
    this.commandFolder = `${this.plugin.settings.stewardFolder}/Commands`;
    this.initialize();
  }

  get commandProcessorService() {
    return this.plugin.commandProcessorService;
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

      // Wait for the vault to be ready
      await sleep(500);

      // Load all command definitions
      await this.loadAllCommands();

      // Watch for changes to command files
      this.plugin.registerEvent(
        this.plugin.app.vault.on('modify', file => this.handleFileModification(file as TFile))
      );
      this.plugin.registerEvent(
        this.plugin.app.vault.on('create', file => this.handleFileCreation(file as TFile))
      );
      this.plugin.registerEvent(
        this.plugin.app.vault.on('delete', file => this.handleFileDeletion(file as TFile))
      );
    } catch (error) {
      logger.error('Error initializing UserDefinedCommandService:', error);
    }
  }

  /**
   * Load all command definitions from the Commands folder
   */
  private async loadAllCommands(): Promise<void> {
    const folder = this.plugin.app.vault.getAbstractFileByPath(this.commandFolder);

    if (!(folder instanceof TFolder)) {
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

      const content = await this.plugin.app.vault.read(file);

      // Extract JSON blocks from the content
      const jsonBlocks = await this.extractJsonBlocks(content);

      for (const jsonContent of jsonBlocks) {
        try {
          const commandDefinition = JSON.parse(jsonContent) as UserDefinedCommand;

          // Add file path to the command definition
          commandDefinition.file_path = file.path;

          if (this.validateCommandDefinition(commandDefinition)) {
            this.userDefinedCommands.set(commandDefinition.command_name, commandDefinition);
            logger.log(
              `Loaded user-defined command: ${commandDefinition.command_name}, \n\nCommand Definition: \n${JSON.stringify(
                commandDefinition,
                null,
                2
              )}`
            );
          }
        } catch (jsonError) {
          logger.error(`Invalid JSON in file ${file.path}:`, jsonError);
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

    this.userDefinedCommands.forEach((command, commandName) => {
      if (command.file_path === filePath) {
        commandsToRemove.push(commandName);
      }
    });

    // Remove the found commands
    for (const commandName of commandsToRemove) {
      this.userDefinedCommands.delete(commandName);
      logger.log(`Removed command ${commandName} from ${filePath}`);
    }
  }

  /**
   * Extract JSON blocks from markdown content
   */
  private async extractJsonBlocks(content: string): Promise<string[]> {
    const jsonBlocks: string[] = [];
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/gi;

    let match;
    while ((match = jsonRegex.exec(content)) !== null) {
      if (match[1]) {
        // Process any wiki links in the JSON content
        const jsonContent = await this.processContent(match[1]);
        jsonBlocks.push(jsonContent);
      }
    }

    return jsonBlocks;
  }

  /**
   * Get content from a path, which can be a normal path, with an anchor, or with alias
   * @param linkPath The path to the file (e.g., "Note Name", "Note Name#Heading", "Note Name#Heading|Alias")
   * @returns The content of the file or section, properly escaped for JSON
   */
  private async getContentByPath(linkPath: string): Promise<string | null> {
    // Parse the link path to extract path, anchor, and alias
    let path = linkPath;
    let anchor: string | undefined;

    // Check for alias (|)
    const aliasParts = path.split('|');
    if (aliasParts.length > 1) {
      path = aliasParts[0];
      // Alias is not used currently, but we need to remove it from the path
    }

    // Check for anchor (#)
    const anchorParts = path.split('#');
    if (anchorParts.length > 1) {
      path = anchorParts[0];
      anchor = anchorParts[1];
    }

    // Try to find the file
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(path, '');

    if (!file) {
      logger.warn(`Could not resolve link: ${linkPath}`);
      return null;
    }

    try {
      // Read the file content
      const noteContent = await this.plugin.app.vault.read(file);

      // Get content based on whether there's an anchor or not
      let contentToInsert = noteContent;

      if (anchor) {
        // Extract content under the specified heading
        contentToInsert = this.extractContentUnderHeading(noteContent, anchor);
      }

      // We need to escape quotes and newlines to maintain valid JSON
      return contentToInsert
        .replace(/\\/g, '\\\\') // Escape backslashes
        .replace(/"/g, '\\"') // Escape quotes
        .replace(/\n/g, '\\n') // Escape newlines
        .replace(/\r/g, '\\r') // Escape carriage returns
        .replace(/\t/g, '\\t'); // Escape tabs
    } catch (error) {
      logger.error(`Error reading file content for ${linkPath}:`, error);
      return null;
    }
  }

  /**
   * Extract content under a specific heading
   * @param content The full content to search in
   * @param headingText The heading text to find
   * @returns The content under the heading
   */
  private extractContentUnderHeading(content: string, headingText: string): string {
    const lines = content.split('\n');
    let foundHeading = false;
    let headingLevel = 0;
    const result: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line is a heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        const level = headingMatch[1].length; // Number of # symbols
        const heading = headingMatch[2].trim();

        if (foundHeading) {
          // If we've already found our heading and this is same or higher level, stop
          if (level <= headingLevel) {
            break;
          }
        } else if (heading === headingText) {
          // Found our target heading
          foundHeading = true;
          headingLevel = level;
          // Don't include the heading line itself
          continue;
        }
      }

      // Add this line if we've found our heading
      if (foundHeading) {
        result.push(line);
      }
    }

    return result.join('\n').trim();
  }

  /**
   * Process content
   * - Replace wiki links with the content of the linked note
   * - If link has an anchor (e.g., [[Note#Heading]]), only include content under that heading
   * - Escape quotes and newlines to maintain valid JSON
   */
  private async processContent(content: string): Promise<string> {
    // Find all wiki links in the content
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    let result = content;

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const fullMatch = match[0]; // The full match, e.g. [[Note Name]] or [[Note Name#Heading|Alias]]
      const linkPath = match[1]; // The link path, which can include anchor and alias

      // Get content for this link path
      const resolvedContent = await this.getContentByPath(linkPath);

      if (resolvedContent !== null) {
        // Replace the link with the content in the result
        result = result.replace(fullMatch, resolvedContent);
      }
    }

    return result;
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
      // Find and remove any commands from this file
      // Since we can't easily determine which command was in this file,
      // we'll reload all commands
      this.loadAllCommands();
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
      const content = step.query.replace('$from_user', userInput.trim());

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

      return {
        commandType: step.name,
        systemPrompts,
        content,
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
      if (this.hasCommand(intent.commandType)) {
        if (visited.has(intent.commandType)) {
          // Check if this is a built-in command
          const isBuiltInCommand = this.commandProcessorService.isBuiltInCommand(
            intent.commandType
          );

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
          intent.content || userInput
        );
        if (subIntents) {
          expanded.push(...this.expandUserDefinedCommandIntents(subIntents, userInput, visited));
        }
        visited.delete(intent.commandType);
      } else {
        expanded.push(intent);
      }
    }
    return expanded;
  }
}
