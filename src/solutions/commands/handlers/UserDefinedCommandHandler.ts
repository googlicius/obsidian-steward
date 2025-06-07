import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { CommandProcessor } from '../CommandProcessor';

export class UserDefinedCommandHandler extends CommandHandler {
	isContentRequired = (commandType: string): boolean => {
		const userDefinedCommand =
			this.plugin.userDefinedCommandService?.userDefinedCommands.get(commandType);
		return !!(userDefinedCommand && userDefinedCommand.query_required);
	};

	constructor(
		public readonly plugin: StewardPlugin,
		private readonly commandProcessor: CommandProcessor
	) {
		super();
	}

	/**
	 * Render the loading indicator for user-defined commands
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));
	}

	/**
	 * Handle a user-defined command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command } = params;

		try {
			// Get the user-defined command definition
			const commandIntents = this.plugin.userDefinedCommandService.processUserDefinedCommand(
				command.commandType,
				command.content
			);

			if (!commandIntents) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `*Error: User-defined command '${command.commandType}' not found*`,
					role: 'Steward',
				});

				return {
					status: CommandResultStatus.ERROR,
					error: new Error(`User-defined command '${command.commandType}' not found`),
				};
			}

			// Process the commands
			await this.commandProcessor.processCommands({
				title,
				commands: commandIntents,
				lang: params.lang,
			});

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error processing user-defined command: ${error.message}*`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
