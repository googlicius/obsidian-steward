import { ConversationCommandReceivedPayload } from '../../types/events';
import { CommandResultStatus, CommandHandler, CommandResult } from './CommandHandler';
import { logger } from '../../utils/logger';
import { CommandIntent } from '../../lib/modelfusion/extractions';
import { NoteContentService } from '../../services/NoteContentService';
import type StewardPlugin from 'src/main';

interface PendingCommand {
  commands: CommandIntent[];
  currentIndex: number;
  payload: ConversationCommandReceivedPayload;
  lastCommandResult?: CommandResult;
}

interface ProcessCommandsOptions {
  skipIndicators?: boolean;
  skipGeneralCommandCheck?: boolean;
  skipConfirmationCheck?: boolean;
  /**
   * If true, the built-in handler will be used in case a user-defined command has the same name as a built-in command.
   */
  builtInCommandPrecedence?: boolean;
  /**
   * If true, indicates this is a reload request
   */
  isReloadRequest?: boolean;
}

export class CommandProcessor {
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private userDefinedCommandHandler: CommandHandler | null = null;

  constructor(private readonly plugin: StewardPlugin) {}

  get userDefinedCommandService() {
    return this.plugin.userDefinedCommandService;
  }

  /**
   * Register a command handler for a specific command type
   */
  public registerHandler(commandType: string, handler: CommandHandler): void {
    this.commandHandlers.set(commandType, handler);
  }

  /**
   * Register a user-defined command handler for handling user-defined commands
   */
  public registerUserDefinedCommandHandler(handler: CommandHandler): void {
    this.userDefinedCommandHandler = handler;
  }

  /**
   * Process a list of commands
   */
  public async processCommands(
    payload: ConversationCommandReceivedPayload,
    options: ProcessCommandsOptions = {}
  ): Promise<void> {
    const { title, commands } = payload;

    // Preprocessing for general commands
    // This prevents accidentally resetting pending commands when a general command
    // might actually be a confirmation command
    if (this.isGeneralCommand(commands) && !options.skipGeneralCommandCheck) {
      await this.processCommandInIsolation(payload, commands[0].commandType, {
        ...options,
        skipGeneralCommandCheck: true,
      });
      return;
    }

    // Check if this is a confirmation command
    if (this.isConfirmation(commands) && !options.skipConfirmationCheck) {
      await this.processCommandInIsolation(payload, commands[0].commandType, {
        ...options,
        skipConfirmationCheck: true,
      });
      return;
    }

    // Start new command processing
    this.pendingCommands.set(title, {
      commands,
      currentIndex: 0,
      payload,
    });

    await this.continueProcessing(title, options);
  }

  /**
   * Process a single command with an isolated CommandProcessor instance
   * This allows processing the command without interfering with pending commands
   */
  private async processCommandInIsolation(
    payload: ConversationCommandReceivedPayload,
    commandType: string,
    options: ProcessCommandsOptions = {}
  ): Promise<void> {
    const isolatedProcessor = new CommandProcessor(this.plugin);

    const handler = this.commandHandlers.get(commandType);
    if (handler) {
      isolatedProcessor.registerHandler(commandType, handler);
    } else {
      logger.warn(`No command handler found for command type: ${commandType}`);
      return;
    }

    await isolatedProcessor.processCommands(payload, options);
  }

  private isConfirmation(commands: CommandIntent[]): boolean {
    const cmd = commands[0];

    if (!cmd) return false;

    return cmd.commandType === 'confirm' || cmd.commandType === 'yes' || cmd.commandType === 'no';
  }

  private isGeneralCommand(commands: CommandIntent[]): boolean {
    return commands.length === 1 && commands[0].commandType === ' ';
  }

  private isUserDefinedCommand(commandType: string, builtInCommandPrecedence: boolean): boolean {
    if (!this.userDefinedCommandService.userDefinedCommands.has(commandType)) {
      return false;
    }

    if (this.commandHandlers.has(commandType) && builtInCommandPrecedence) {
      return false;
    }

    return true;
  }

  /**
   * Continue processing commands from the current index
   */
  public async continueProcessing(
    title: string,
    options: ProcessCommandsOptions = {}
  ): Promise<void> {
    const { builtInCommandPrecedence = false } = options;

    const pendingCommand = this.pendingCommands.get(title);
    if (!pendingCommand) {
      logger.warn(`No pending commands for conversation: ${title}`);
      return;
    }

    const { commands, currentIndex, payload } = pendingCommand;
    const noteContentService = NoteContentService.getInstance(this.plugin.app);

    // Process commands sequentially from current index
    for (let i = currentIndex; i < commands.length; i++) {
      const command = commands[i];
      const prevCommand = i > 0 ? commands[i - 1] : undefined;
      const nextCommand = i < commands.length - 1 ? commands[i + 1] : undefined;
      const nextIndex = i + 1;

      // Process wikilinks in command.systemPrompts
      if (command.systemPrompts && command.systemPrompts.length > 0) {
        const processedPrompts = await Promise.all(
          command.systemPrompts.map(prompt => {
            return noteContentService.processWikilinksInContent(prompt, 2);
          })
        );
        command.systemPrompts = processedPrompts;
      }

      // Find the appropriate handler
      let handler = this.commandHandlers.get(command.commandType);

      // If we have a user-defined command handler, use it regardless of the current handler
      if (
        this.userDefinedCommandHandler &&
        this.isUserDefinedCommand(command.commandType, builtInCommandPrecedence)
      ) {
        handler = this.userDefinedCommandHandler;
      }

      if (!handler) {
        logger.warn(`No handler for command type: ${command.commandType}`);
        // Continue to the next command instead of stopping
        continue;
      }

      // Show indicator if not skipped and handler has renderIndicator method
      if (!options.skipIndicators && handler.renderIndicator) {
        await handler.renderIndicator(title, payload.lang);
      }

      // Execute the command
      try {
        const result = await handler.handle({
          title,
          command,
          prevCommand,
          nextCommand,
          lang: payload.lang,
          isReloadRequest: options.isReloadRequest,
        });

        // Command completed successfully
        this.pendingCommands.set(title, {
          ...pendingCommand,
          currentIndex: nextIndex,
          lastCommandResult: result,
        });

        // Handle the result
        if (result.status === CommandResultStatus.ERROR) {
          logger.error(`Command failed: ${command.commandType}`, result.error);
          // Stop processing on error
          this.pendingCommands.delete(title);
          return;
        } else if (result.status === CommandResultStatus.NEEDS_CONFIRMATION) {
          // Pause processing until confirmation is received
          logger.log(`Command needs confirmation: ${command.commandType}`);
          return;
        }
      } catch (error) {
        logger.error(`Unexpected error in command: ${command.commandType}`, error);
        this.pendingCommands.delete(title);
        return;
      }
    }

    // All commands processed successfully
    this.pendingCommands.delete(title);
  }

  /**
   * Delete the next pending command for a conversation
   */
  public deleteNextPendingCommand(title: string): void {
    const pendingCommand = this.pendingCommands.get(title);
    if (!pendingCommand) return;

    // Set index to skip the next command
    const nextIndex = pendingCommand.currentIndex + 1;
    this.pendingCommands.set(title, {
      ...pendingCommand,
      currentIndex: nextIndex,
    });
  }

  /**
   * Get pending command for a conversation
   */
  public getPendingCommand(title: string): PendingCommand | undefined {
    return this.pendingCommands.get(title);
  }

  /**
   * Set the current index for a pending command
   */
  public setCurrentIndex(title: string, index: number): void {
    const pendingCommand = this.pendingCommands.get(title);
    if (pendingCommand) {
      this.pendingCommands.set(title, {
        ...pendingCommand,
        currentIndex: index,
      });
    }
  }

  /**
   * Get the command handler for a specific command type
   */
  public getCommandHandler(commandType: string): CommandHandler | null {
    return this.commandHandlers.get(commandType) || this.userDefinedCommandHandler;
  }

  /**
   * Check if a command type has a built-in handler
   */
  public hasBuiltInHandler(commandType: string): boolean {
    return this.commandHandlers.has(commandType);
  }
}
