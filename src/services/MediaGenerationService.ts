import { MediaTools } from '../tools/mediaTools';
import { logger } from '../utils/logger';
import { eventEmitter, Events } from './EventEmitter';
import { ConversationRenderer } from './ConversationRenderer';
import StewardPlugin from '../main';
import { extractMediaCommand } from '../lib/modelfusion/mediaExtraction';

export class MediaGenerationService {
	private mediaTools: MediaTools;
	private renderer: ConversationRenderer;
	private plugin: StewardPlugin;

	constructor(plugin: StewardPlugin) {
		this.mediaTools = new MediaTools(plugin.app);
		this.renderer = new ConversationRenderer(plugin);
		this.plugin = plugin;
	}

	/**
	 * Handle a media generation command from the chat
	 */
	async handleMediaCommand({
		title,
		commandContent,
		commandType,
	}: {
		title: string;
		commandContent: string;
		commandType: 'image' | 'audio';
	}): Promise<void> {
		try {
			// Extract media command parameters
			const extraction = await extractMediaCommand(commandContent, commandType);

			// For audio commands, update the voice setting if it's different
			if (
				commandType === 'audio' &&
				extraction.voice &&
				extraction.voice !== this.plugin.settings.audio.voice
			) {
				this.plugin.settings.audio.voice = extraction.voice;
				await this.plugin.saveSettings();
			}

			// Emit event to show generating indicator
			eventEmitter.emit(Events.MEDIA_GENERATION_STARTED, {
				type: commandType,
				prompt: extraction.text,
			});

			// Generate the media with supported options
			const result = await this.mediaTools.generateMedia({
				type: commandType,
				prompt: extraction.text,
				size: extraction.size,
				quality: extraction.quality,
				model: commandType === 'audio' && extraction.voice ? 'tts-1' : undefined,
				voice:
					commandType === 'audio'
						? extraction.voice || this.plugin.settings.audio.voice
						: undefined,
			});

			if (result.success && result.filePath) {
				// Emit event for successful generation
				eventEmitter.emit(Events.MEDIA_GENERATION_COMPLETED, {
					type: commandType,
					filePath: result.filePath,
					metadata: result.metadata || {
						model: 'default',
						prompt: extraction.text,
						timestamp: Date.now(),
					},
				});

				// Update the conversation with the media link
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `\n![[${result.filePath}]]`,
					role: 'Steward',
					command: commandType,
				});
			} else {
				// Emit event for failed generation
				eventEmitter.emit(Events.MEDIA_GENERATION_FAILED, {
					type: commandType,
					error: result.error || 'Unknown error occurred',
				});

				// Update the conversation with the error message
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `Failed to generate ${commandType}: ${result.error}`,
					role: 'Steward',
					command: commandType,
				});
			}
		} catch (error) {
			logger.error('Error handling media command:', error);

			// Update the conversation with the error message
			await this.renderer.updateConversationNote({
				path: this.plugin.staticConversationTitle,
				newContent: `Error generating media: ${error.message}`,
				role: 'Steward',
				command: 'media',
			});
		}
	}
}
