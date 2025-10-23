import { ConversationCommandReceivedPayload } from '../../types/events';
import { CommandResultStatus, CommandHandler, CommandResult } from './CommandHandler';
import { logger } from '../../utils/logger';
import { CommandIntent } from 'src/types/types';
import type StewardPlugin from 'src/main';
import { SystemPromptModifier, SystemPromptModification } from './SystemPromptModifier';

interface PendingCommand {
  commands: CommandIntent[];
  currentIndex: number;
  payload: ConversationCommandReceivedPayload;
  lastCommandResult?: CommandResult;
}

export interface ProcessCommandsOptions {
  skipIndicators?: boolean;
  skipGeneralCommandCheck?: boolean;
  skipConfirmationCheck?: boolean;
  /**
   * If true, the built-in handler will be used in case a user-defined command has the same name as a built-in command.
   */
  builtInCommandPrecedence?: boolean;
  sendToDownstream?: {
    /**
     * If true, indicates this is a reload request
     */
    isReloadRequest?: boolean;
    /**
     * If true, skip the classification check
     */
    ignoreClassify?: boolean;
  };
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
      // Check if we're waiting for user input (not yes/no confirmation)
      if (this.isWaitingForUserInput(title)) {
        await this.handleUserInput(title, commands[0]);
        return;
      }

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
   * This allows processing the command without interfering with pending commands in the main processor
   */
  public async processCommandInIsolation(
    payload: ConversationCommandReceivedPayload,
    commandType: string,
    options: ProcessCommandsOptions = {}
  ): Promise<void> {
    const isolatedProcessor = new CommandProcessor(this.plugin);

    const contextAugmentationHandler = this.commandHandlers.get('context_augmentation');

    if (contextAugmentationHandler) {
      isolatedProcessor.registerHandler('context_augmentation', contextAugmentationHandler);
    }

    const handler = this.commandHandlers.get(commandType);
    if (handler) {
      isolatedProcessor.registerHandler(commandType, handler);
    } else {
      logger.warn(`No command handler found for command type: ${commandType}`);
      return;
    }

    await isolatedProcessor.processCommands(payload, options);
  }

  public isProcessing(title: string): boolean {
    return this.pendingCommands.has(title);
  }

  private isWaitingForUserInput(title: string): boolean {
    const pendingCommand = this.pendingCommands.get(title);
    if (!pendingCommand || !pendingCommand.lastCommandResult) return false;
    return pendingCommand.lastCommandResult.status === CommandResultStatus.NEEDS_USER_INPUT;
  }

  private isConfirmation(commands: CommandIntent[]): boolean {
    if (!commands || commands.length === 0) return false;

    return commands.some(
      cmd => cmd.commandType === 'confirm' || cmd.commandType === 'yes' || cmd.commandType === 'no'
    );
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

    // Process commands sequentially from current index
    for (let i = currentIndex; i < commands.length; i++) {
      const command = commands[i];
      const prevCommand = i > 0 ? commands[i - 1] : undefined;
      const nextCommand = i < commands.length - 1 ? commands[i + 1] : undefined;
      const nextIndex = i + 1;

      // Process wikilinks in command.systemPrompts (only for string-based prompts)
      if (command.systemPrompts && command.systemPrompts.length > 0) {
        command.systemPrompts = await this.processSystemPromptsWikilinks(command.systemPrompts);
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
        logger.warn(`No handler for command type: ${command.commandType}`, this.commandHandlers);
        // Continue to the next command instead of stopping
        continue;
      }

      // Show indicator if not skipped and handler has renderIndicator method
      if (!options.skipIndicators && handler.renderIndicator) {
        await handler.renderIndicator(title, payload.lang);
      }

      const result = await handler.safeHandle({
        title,
        command,
        prevCommand,
        nextCommand,
        lang: payload.lang,
        upstreamOptions: options.sendToDownstream,
      });

      // Command completed successfully
      this.pendingCommands.set(title, {
        ...pendingCommand,
        currentIndex: nextIndex,
        lastCommandResult: result,
      });

      // Handle the result
      switch (result.status) {
        case CommandResultStatus.ERROR:
          logger.error(`Command failed: ${command.commandType}`, result.error);
          // Stop processing on error
          this.pendingCommands.delete(title);
          return;

        case CommandResultStatus.NEEDS_CONFIRMATION:
        case CommandResultStatus.NEEDS_USER_INPUT:
          // Pause processing until user provides additional input
          return;

        case CommandResultStatus.LOW_CONFIDENCE:
          logger.log(
            `Low confidence in command: ${command.commandType}, attempting context augmentation`
          );

          await this.processCommands({
            title,
            commands: [
              {
                commandType: 'context_augmentation',
                query: '',
                retryRemaining: 0, // We disable the context augmentation for now.
              },
            ],
            lang: payload.lang,
          });

          // Stop the current command processing
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

  /**
   * Clear all pending commands for a conversation
   */
  public clearCommands(title: string): void {
    this.pendingCommands.delete(title);
  }

  /**
   * Handle user input for a pending command that requested it
   */
  private async handleUserInput(title: string, command: CommandIntent): Promise<void> {
    const pendingCommand = this.pendingCommands.get(title);
    if (!pendingCommand || !pendingCommand.lastCommandResult) {
      return;
    }

    const lastResult = pendingCommand.lastCommandResult;
    if (lastResult.status !== CommandResultStatus.NEEDS_USER_INPUT) {
      return;
    }

    // Call the onUserInput callback with the user's query
    const result = await lastResult.onUserInput(command.query);

    // Update the pending command with the new result
    this.pendingCommands.set(title, {
      ...pendingCommand,
      lastCommandResult: result,
    });

    // Handle the result
    if (result.status === CommandResultStatus.SUCCESS) {
      // Continue processing the command queue
      await this.continueProcessing(title);
    } else if (result.status === CommandResultStatus.ERROR) {
      logger.error(`User input handling failed: ${title}`, result.error);
      this.pendingCommands.delete(title);
    }
    // If the result is NEEDS_CONFIRMATION or NEEDS_USER_INPUT again,
    // the command will remain pending and wait for the next input
  }

  /**
   * Process wikilinks in system prompts
   * Only processes string-based prompts, keeps modification objects unchanged
   * @param systemPrompts Array of system prompt items (strings or modification objects)
   * @returns Processed system prompts with wikilinks resolved
   */
  private async processSystemPromptsWikilinks(
    systemPrompts: (string | SystemPromptModification)[]
  ): Promise<(string | SystemPromptModification)[]> {
    const modifier = new SystemPromptModifier(systemPrompts);
    const stringPrompts = modifier.getAdditionalSystemPrompts();

    // Process wikilinks only in string-based system prompts
    if (stringPrompts.length === 0) {
      return systemPrompts;
    }

    const processedStrings = await Promise.all(
      stringPrompts.map(prompt =>
        this.plugin.noteContentService.processWikilinksInContent(prompt, 2)
      )
    );

    // Reconstruct systemPrompts: replace strings with processed versions, keep modification objects
    return systemPrompts.map(item => {
      if (typeof item === 'string') {
        // Find the corresponding processed string
        const index = stringPrompts.indexOf(item);
        return processedStrings[index];
      }
      // Keep modification objects unchanged
      return item;
    });
  }
}
