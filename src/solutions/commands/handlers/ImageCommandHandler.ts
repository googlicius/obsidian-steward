import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { extractImageQuery } from 'src/lib/modelfusion/extractions';
import { MediaTools } from 'src/tools/mediaTools';

export class ImageCommandHandler extends CommandHandler {
	private mediaTools: MediaTools;
	isContentRequired = true;

	constructor(public readonly plugin: StewardPlugin) {
		super();
		this.mediaTools = new MediaTools(plugin.app);
	}

	/**
	 * Render the loading indicator for the image command
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		await this.renderer.addGeneratingIndicator(title, t('conversation.generatingImage'));
	}

	/**
	 * Handle an image command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command } = params;

		try {
			const extraction = await extractImageQuery(command.content, this.plugin.settings.llm);

			await this.renderer.updateConversationNote({
				path: title,
				newContent: extraction.explanation,
				role: 'Steward',
			});

			const model = extraction.model || 'dall-e-3';

			// Generate the media with supported options
			const result = await this.mediaTools.generateMedia({
				type: 'image',
				prompt: extraction.text,
				model,
				size: extraction.size,
				quality: extraction.quality,
			});

			await this.renderer.updateConversationNote({
				path: title,
				newContent: `\n![[${result.filePath}]]`,
				command: 'image',
			});

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `Error generating image: ${error.message}`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
