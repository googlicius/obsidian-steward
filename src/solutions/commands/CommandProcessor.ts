import { ConversationCommandReceivedPayload } from '../../types/events';
import { CommandResultStatus, CommandHandler, CommandResult } from './CommandHandler';
import { logger } from '../../utils/logger';
import { CommandIntent } from '../../lib/modelfusion/extractions';

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
}

export class CommandProcessor {
  private pendingCommands: Map<string, PendingCommand> = new Map();

  private commandHandlers: Map<string, CommandHandler> = new Map();
  private userDefinedCommandHandler: CommandHandler | null = null;

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

    // Special handling for general commands
    // This prevents accidentally resetting pending commands when a general command
    // might actually be a confirmation command
    if (this.isGeneralCommand(commands) && !options.skipGeneralCommandCheck) {
      await this.processSingleCommand(payload, commands[0].commandType, {
        ...options,
        skipGeneralCommandCheck: true,
      });
      return;
    }

    // Check if this is a confirmation command
    if (this.isConfirmation(commands) && !options.skipConfirmationCheck) {
      await this.processSingleCommand(payload, commands[0].commandType, {
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
   * Process a single command with a temporary CommandProcessor
   * This allows processing the command without interfering with pending commands
   */
  private async processSingleCommand(
    payload: ConversationCommandReceivedPayload,
    commandType: string,
    options: ProcessCommandsOptions = {}
  ): Promise<void> {
    const tempProcessor = new CommandProcessor();

    const handler = this.commandHandlers.get(commandType);
    if (handler) {
      tempProcessor.registerHandler(commandType, handler);
    } else {
      logger.warn(`No command handler found for command type: ${commandType}`);
      return;
    }

    await tempProcessor.processCommands(payload, options);
  }

  private isConfirmation(commands: CommandIntent[]): boolean {
    const cmd = commands[0];

    if (!cmd) return false;

    return cmd.commandType === 'confirm' || cmd.commandType === 'yes' || cmd.commandType === 'no';
  }

  private isGeneralCommand(commands: CommandIntent[]): boolean {
    return commands.length === 1 && commands[0].commandType === ' ';
  }

  /**
   * Check if a command is a user-defined command that should be handled by the user-defined handler
   */
  private isUserDefinedCommand(commandType: string): boolean {
    // If we have a user-defined command handler and the command is not a built-in one
    return this.userDefinedCommandHandler !== null && !this.commandHandlers.has(commandType);
  }

  /**
   * Continue processing commands from the current index
   */
  public async continueProcessing(
    title: string,
    options: { skipIndicators?: boolean } = {}
  ): Promise<void> {
    const pendingCommand = this.pendingCommands.get(title);
    if (!pendingCommand) {
      logger.warn(`No pending commands for conversation: ${title}`);
      return;
    }

    const { commands, currentIndex, payload } = pendingCommand;

    // Process commands sequentially from current index
    for (let i = currentIndex; i < commands.length; i++) {
      const command = commands[i];
      const prevCommand = i > 0 ? commands[i - 1] : undefined;
      const nextCommand = i < commands.length - 1 ? commands[i + 1] : undefined;
      const nextIndex = i + 1;

      // Find the appropriate handler
      let handler = this.commandHandlers.get(command.commandType);

      // If no handler found and we have a user-defined command handler, use it
      if (
        !handler &&
        this.userDefinedCommandHandler &&
        this.isUserDefinedCommand(command.commandType)
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
}
