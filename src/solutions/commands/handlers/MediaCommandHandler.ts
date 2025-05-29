import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';

export class MediaCommandHandler extends CommandHandler {
	constructor(public readonly plugin: StewardPlugin) {
		super();
	}

	/**
	 * Render the loading indicator for the media command
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		const commandType = this.getCurrentCommandType();

		let message = '';
		switch (commandType) {
			case 'image':
				message = t('conversation.generatingImage');
				break;
			case 'audio':
			case 'speak':
				message = t('conversation.generatingAudio');
				break;
			default:
				message = t('conversation.generating');
		}

		await this.renderer.addGeneratingIndicator(title, message);
	}

	/**
	 * Handle a media command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command } = params;

		try {
			await this.plugin.mediaGenerationService.handleMediaCommand({
				title,
				commandContent: command.content,
				commandType: command.commandType as 'image' | 'audio',
			});

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `Error generating media: ${error.message}`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}

	// Helper method to determine the current command type for indicator message
	private getCurrentCommandType(): string {
		// This will be set by the command processor when registered
		// Default to 'media' as fallback
		return 'media';
	}
}
