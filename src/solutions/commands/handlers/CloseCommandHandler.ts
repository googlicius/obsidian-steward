import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import StewardPlugin from 'src/main';

/**
 * Handler for close commands
 * Closes the conversation and removes the conversation link from the editor
 */
export class CloseCommandHandler extends CommandHandler {
	constructor(public readonly plugin: StewardPlugin) {
		super();
	}

	/**
	 * No loading indicator needed for close command since it's instantaneous
	 */
	public async renderIndicator(): Promise<void> {
		// No loading indicator needed for close
	}

	/**
	 * Handle a close command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title } = params;

		try {
			const success = await this.plugin.closeConversation(title);

			if (!success) {
				return {
					status: CommandResultStatus.ERROR,
					error: new Error('Failed to close conversation'),
				};
			}

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			console.error('Error closing conversation:', error);

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
