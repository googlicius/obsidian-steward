import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { CommandProcessor } from '../CommandProcessor';

export class CustomCommandHandler extends CommandHandler {
	isContentRequired = (commandType: string): boolean => {
		const customCommand = this.plugin.customCommandService?.customCommands.get(commandType);
		return !!(customCommand && customCommand.query_required);
	};

	constructor(
		public readonly plugin: StewardPlugin,
		private readonly commandProcessor: CommandProcessor
	) {
		super();
	}

	/**
	 * Render the loading indicator for custom commands
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));
	}

	/**
	 * Handle a custom command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command } = params;

		try {
			// Get the custom command definition
			const commandIntents = this.plugin.customCommandService.processCustomCommand(
				command.commandType,
				command.content
			);

			if (!commandIntents) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `*Error: Custom command '${command.commandType}' not found*`,
					role: 'Steward',
				});

				return {
					status: CommandResultStatus.ERROR,
					error: new Error(`Custom command '${command.commandType}' not found`),
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
				newContent: `*Error processing custom command: ${error.message}*`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
