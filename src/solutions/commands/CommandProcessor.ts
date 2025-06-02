import { ConversationCommandReceivedPayload } from '../../types/events';
import { CommandResultStatus, CommandHandler, CommandResult } from './CommandHandler';
import { logger } from '../../utils/logger';
import { CommandIntent } from '../../lib/modelfusion/intentExtraction';

interface PendingCommand {
	commands: CommandIntent[];
	currentIndex: number;
	payload: ConversationCommandReceivedPayload;
	lastCommandResult?: CommandResult;
}

export class CommandProcessor {
	private pendingCommands: Map<string, PendingCommand> = new Map();

	private commandHandlers: Map<string, CommandHandler> = new Map();

	/**
	 * Register a command handler for a specific command type
	 */
	public registerHandler(commandType: string, handler: CommandHandler): void {
		this.commandHandlers.set(commandType, handler);
	}

	/**
	 * Process a list of commands
	 */
	public async processCommands(
		payload: ConversationCommandReceivedPayload,
		options: { skipIndicators?: boolean; skipGeneralCommandCheck?: boolean } = {}
	): Promise<void> {
		const { title, commands } = payload;

		// Special handling for general commands
		// This prevents accidentally resetting pending commands when a general command
		// might actually be a confirmation command
		if (
			!options.skipGeneralCommandCheck &&
			commands.length === 1 &&
			commands[0].commandType === ' '
		) {
			await this.processGeneralCommand(payload, options);
			return;
		}

		// Check if this is a confirmation command
		if (this.isConfirmation(commands) && this.pendingCommands.has(title)) {
			await this.processConfirmation(payload, options);
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
	 * Process a general command with a temporary CommandProcessor
	 * This allows processing the command without interfering with pending commands
	 */
	private async processGeneralCommand(
		payload: ConversationCommandReceivedPayload,
		options: { skipIndicators?: boolean } = {}
	): Promise<void> {
		const tempProcessor = new CommandProcessor();

		const generalHandler = this.commandHandlers.get(' ');
		if (generalHandler) {
			tempProcessor.registerHandler(' ', generalHandler);
		} else {
			logger.warn('No general command handler found');
			return;
		}

		await tempProcessor.processCommands(payload, {
			...options,
			skipGeneralCommandCheck: true,
		});
	}

	private isConfirmation(commands: CommandIntent[]): boolean {
		return commands.some(
			cmd => cmd.commandType === 'confirm' || cmd.commandType === 'yes' || cmd.commandType === 'no'
		);
	}

	/**
	 * Process a confirmation command for a pending command
	 */
	private async processConfirmation(
		payload: ConversationCommandReceivedPayload,
		options: { skipIndicators?: boolean } = {}
	): Promise<void> {
		const { title, commands } = payload;

		// There should be only one confirmation command
		if (commands.length !== 1) {
			logger.warn('Expected a single confirmation command, got', commands.length);
		}

		const confirmCommand = commands[0];

		// Get the handler for this command type
		const handler = this.commandHandlers.get(confirmCommand.commandType);
		if (!handler) {
			logger.warn(`No handler for confirmation command type: ${confirmCommand.commandType}`);
			return;
		}

		// Show indicator if not skipped and handler has renderIndicator method
		if (!options.skipIndicators && handler.renderIndicator) {
			await handler.renderIndicator(title, payload.lang);
		}

		try {
			// Execute the confirmation command
			const pendingCommand = this.pendingCommands.get(title);
			if (!pendingCommand) {
				logger.warn('No pending command found for confirmation');
				return;
			}

			// Get previous command and next command
			const { currentIndex } = pendingCommand;
			const prevCommand = pendingCommand.commands[currentIndex];

			// Execute the confirmation command with context
			const result = await handler.handle({
				title,
				command: confirmCommand,
				prevCommand,
				lang: payload.lang,
			});

			// After confirmation is processed, continue with command processing
			if (result.status === CommandResultStatus.SUCCESS) {
				// Continue processing remaining commands
				await this.continueProcessing(title, options);
			} else if (result.status === CommandResultStatus.ERROR) {
				// If there was an error, log it but don't delete pending commands
				// This allows retrying the confirmation
				logger.error(`Confirmation command failed: ${confirmCommand.commandType}`, result.error);
			}
		} catch (error) {
			logger.error(
				`Unexpected error in confirmation command: ${confirmCommand.commandType}`,
				error
			);
		}
	}

	/**
	 * Continue processing commands from the current index
	 */
	private async continueProcessing(
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
			const handler = this.commandHandlers.get(command.commandType);
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
	 * Delete the next pending command
	 */
	public deleteNextPendingCommand(title: string): void {
		const pendingCommand = this.pendingCommands.get(title);
		if (pendingCommand) {
			pendingCommand.commands.splice(pendingCommand.currentIndex, 1);
		}
	}

	/**
	 * Get the pending command data for a conversation
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
}
