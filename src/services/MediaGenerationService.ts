import { MediaTools } from '../tools/mediaTools';
import { logger } from '../utils/logger';
import { eventEmitter } from './EventEmitter';
import { ConversationRenderer } from './ConversationRenderer';
import StewardPlugin from '../main';
import { extractMediaCommand } from '../lib/modelfusion/mediaExtraction';
import { Events } from '../types/events';

export class MediaGenerationService {
	private mediaTools: MediaTools;
	private renderer: ConversationRenderer;
	private plugin: StewardPlugin;

	constructor(plugin: StewardPlugin) {
		this.mediaTools = new MediaTools(plugin.app);
		this.renderer = new ConversationRenderer(plugin);
		this.plugin = plugin;
		this.setupEventListeners();
	}

	/**
	 * Set up event listeners for media generation events
	 */
	private setupEventListeners(): void {
		eventEmitter.on(
			Events.MEDIA_GENERATION_COMPLETED,
			this.handleMediaGenerationCompleted.bind(this)
		);
	}

	/**
	 * Handle successful media generation
	 */
	private async handleMediaGenerationCompleted(data: {
		type: 'image' | 'audio';
		filePath: string;
		metadata: {
			model?: string;
			prompt: string;
			timestamp: number;
			voice?: string;
		};
	}): Promise<void> {
		try {
			// Only update settings for audio generation
			if (data.type === 'audio') {
				const currentModel = this.plugin.settings.audio.model;

				if (data.metadata.model && data.metadata.model !== this.plugin.settings.audio.model) {
					this.plugin.settings.audio.model = data.metadata.model;
				}

				if (
					data.metadata.voice &&
					data.metadata.voice !== this.plugin.settings.audio.voices[currentModel]
				) {
					this.plugin.settings.audio.voices[currentModel] = data.metadata.voice;
				}

				await this.plugin.saveSettings();
			}
		} catch (error) {
			logger.error('Error handling media generation completion:', error);
		}
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

			// Emit event to show generating indicator
			eventEmitter.emit(Events.MEDIA_GENERATION_STARTED, {
				type: commandType,
				prompt: extraction.text,
			});

			const model = extraction.model || this.plugin.settings.audio.model;

			// Generate the media with supported options
			const result = await this.mediaTools.generateMedia({
				type: commandType,
				prompt: extraction.text,
				size: extraction.size,
				quality: extraction.quality,
				model,
				voice: extraction.voice || this.plugin.settings.audio.voices[model],
			});

			if (result.success && result.filePath) {
				// Emit event for successful generation
				eventEmitter.emit(Events.MEDIA_GENERATION_COMPLETED, {
					type: commandType,
					filePath: result.filePath,
					metadata: {
						model: extraction.model,
						prompt: extraction.text,
						timestamp: Date.now(),
						voice: extraction.voice,
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
				path: title,
				newContent: `Error generating media: ${error.message}`,
				role: 'Steward',
				command: 'media',
			});
		}
	}
}
