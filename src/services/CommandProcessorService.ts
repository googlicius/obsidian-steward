import { CommandProcessor } from '../solutions/commands';
import { ConversationCommandReceivedPayload } from '../types/events';
import StewardPlugin from '../main';
import { logger } from '../utils/logger';
import {
	MoveCommandHandler,
	SearchCommandHandler,
	MoreCommandHandler,
	DeleteCommandHandler,
	CopyCommandHandler,
	UpdateCommandHandler,
	CreateCommandHandler,
	ReadCommandHandler,
	GenerateCommandHandler,
	GeneralCommandHandler,
	CloseCommandHandler,
	ConfirmCommandHandler,
	StopCommandHandler,
	AudioCommandHandler,
	ImageCommandHandler,
	UserDefinedCommandHandler,
} from '../solutions/commands/handlers';
import { getTextContentWithoutImages } from 'src/lib/modelfusion/utils/userMessageUtils';

export class CommandProcessorService {
	private readonly commandProcessor: CommandProcessor;
	private userDefinedCommandHandler: UserDefinedCommandHandler;

	constructor(private readonly plugin: StewardPlugin) {
		this.commandProcessor = new CommandProcessor();

		this.setupHandlers();
	}

	/**
	 * Setup command handlers
	 */
	private setupHandlers(): void {
		// Register the close command handler
		const closeHandler = new CloseCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('close', closeHandler);

		// Register the move command handler
		const moveHandler = new MoveCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('move', moveHandler);
		this.commandProcessor.registerHandler('move_from_artifact', moveHandler);

		// Register the confirmation handler
		const confirmHandler = new ConfirmCommandHandler(this.plugin, this.commandProcessor);
		this.commandProcessor.registerHandler('confirm', confirmHandler);
		this.commandProcessor.registerHandler('yes', confirmHandler);
		this.commandProcessor.registerHandler('no', confirmHandler);

		// Register the search handler
		const searchHandler = new SearchCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('search', searchHandler);

		// Register the more handler for pagination
		const moreHandler = new MoreCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('more', moreHandler);

		// Register the image command handler
		const imageHandler = new ImageCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('image', imageHandler);

		// Register the audio command handler
		const audioHandler = new AudioCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('audio', audioHandler);
		this.commandProcessor.registerHandler('speak', audioHandler);

		// Register the delete command handler
		const deleteHandler = new DeleteCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('delete', deleteHandler);
		this.commandProcessor.registerHandler('delete_from_artifact', deleteHandler);

		// Register the copy command handler
		const copyHandler = new CopyCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('copy_from_artifact', copyHandler);

		// Register the update command handler
		const updateHandler = new UpdateCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('update_from_artifact', updateHandler);

		// Register the create command handler
		const createHandler = new CreateCommandHandler(this.plugin, this.commandProcessor);
		this.commandProcessor.registerHandler('create', createHandler);

		// Register the read command handler
		const readHandler = new ReadCommandHandler(this.plugin, this.commandProcessor);
		this.commandProcessor.registerHandler('read', readHandler);

		// Register the generate command handler
		const generateHandler = new GenerateCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('generate', generateHandler);

		// Register the stop command handler
		const stopHandler = new StopCommandHandler(this.plugin);
		this.commandProcessor.registerHandler('stop', stopHandler);
		this.commandProcessor.registerHandler('abort', stopHandler);

		// Register the general command handler (space)
		const generalHandler = new GeneralCommandHandler(this.plugin, this.commandProcessor);
		this.commandProcessor.registerHandler(' ', generalHandler);

		// Register the user-defined command handler
		this.userDefinedCommandHandler = new UserDefinedCommandHandler(
			this.plugin,
			this.commandProcessor
		);
		this.commandProcessor.registerUserDefinedCommandHandler(this.userDefinedCommandHandler);
	}

	/**
	 * Process commands
	 */
	public async processCommands(
		payload: ConversationCommandReceivedPayload,
		options: { skipIndicators?: boolean } = {}
	): Promise<boolean> {
		try {
			await this.commandProcessor.processCommands(payload, options);
			return true;
		} catch (error) {
			logger.error('Error processing commands:', error);
			return false;
		}
	}

	/**
	 * Validate if the command content is required for a specific command type
	 */
	public validateCommandContent(commandType: string, commandContent: string): boolean {
		const handler = this.commandProcessor.getCommandHandler(commandType);
		if (!handler) return true;

		const isContentRequired =
			typeof handler.isContentRequired === 'function'
				? handler.isContentRequired(commandType)
				: handler.isContentRequired;

		return isContentRequired ? getTextContentWithoutImages(commandContent) !== '' : true;
	}
}
