import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { extractCommandIntent } from 'src/lib/modelfusion';
import { Events } from 'src/types/events';
import { eventEmitter } from 'src/services/EventEmitter';

export class GeneralCommandHandler extends CommandHandler {
	constructor(public readonly plugin: StewardPlugin) {
		super();
	}

	/**
	 * Render the loading indicator for the general command
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		await this.renderer.addGeneratingIndicator(title, t('conversation.workingOnIt'));
	}

	/**
	 * Handle a general command (space)
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command } = params;

		try {
			// Extract the command intent using AI
			const intentExtraction = await extractCommandIntent(command.content, {
				...this.settings.llm,
			});

			// For low confidence intents, just show the explanation without further action
			if (intentExtraction.confidence <= 0.7) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: intentExtraction.explanation,
					role: 'Steward',
				});

				return {
					status: CommandResultStatus.SUCCESS,
				};
			}

			// For confident intents, emit an event to trigger appropriate command handlers
			eventEmitter.emit(Events.COMMAND_INTENT_EXTRACTED, {
				title,
				intentExtraction,
			});

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error processing your request: ${error.message}*`,
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
