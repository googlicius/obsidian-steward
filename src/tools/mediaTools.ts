import { App, TFile } from 'obsidian';
import { logger } from '../utils/logger';
import {
	generateImage,
	generateSpeech,
	openai,
	OpenAISpeechModelType,
	OpenAISpeechVoice,
} from 'modelfusion';

export interface MediaGenerationOptions {
	prompt: string;
	type: 'image' | 'audio';
	model?: string;
	size?: string;
	quality?: string;
	format?: string;
	voice?: string;
}

export interface MediaGenerationResult {
	success: boolean;
	filePath?: string;
	error?: string;
	metadata?: {
		model: string;
		prompt: string;
		timestamp: number;
	};
}

export class MediaTools {
	private readonly app: App;
	private readonly mediaFolder: string;

	constructor(app: App, mediaFolder?: string) {
		this.app = app;
		// Use the attachments folder path from Obsidian settings if no mediaFolder is provided
		this.mediaFolder = mediaFolder || this.getAttachmentsFolderPath();
	}

	/**
	 * Get the attachments folder path from Obsidian settings
	 */
	private getAttachmentsFolderPath(): string {
		// @ts-ignore - Accessing internal Obsidian API
		const attachmentsFolder = this.app.vault.config.attachmentFolderPath;
		return attachmentsFolder || 'attachments';
	}

	/**
	 * Generate media (image or audio) based on the provided options
	 */
	async generateMedia(options: MediaGenerationOptions): Promise<MediaGenerationResult> {
		try {
			// Ensure media folder exists
			await this.ensureMediaFolderExists();

			// Generate unique filename
			const timestamp = Date.now();
			const filename = `${options.type}_${timestamp}`;
			const extension = this.getFileExtension(options);

			// Generate the media using the appropriate model
			const result = await this.generateMediaContent(options);

			if (!result.success || !result.data) {
				return {
					success: false,
					error: result.error || 'Failed to generate media',
				};
			}

			// Save the generated media to a file
			const filePath = `${this.mediaFolder}/${filename}.${extension}`;
			await this.app.vault.createBinary(filePath, result.data);

			return {
				success: true,
				filePath,
				metadata: {
					model: options.model || 'default',
					prompt: options.prompt,
					timestamp,
				},
			};
		} catch (error) {
			logger.error('Error generating media:', error);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	/**
	 * Ensure the media folder exists
	 */
	private async ensureMediaFolderExists(): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(this.mediaFolder);
		if (!folder) {
			await this.app.vault.createFolder(this.mediaFolder);
		}
	}

	/**
	 * Get the appropriate file extension based on media type and options
	 */
	private getFileExtension(options: MediaGenerationOptions): string {
		if (options.type === 'image') {
			return options.format || 'png';
		} else if (options.type === 'audio') {
			return options.format || 'mp3';
		}
		throw new Error(`Unsupported media type: ${options.type}`);
	}

	/**
	 * Generate media content using the appropriate model
	 */
	private async generateMediaContent(
		options: MediaGenerationOptions
	): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
		try {
			if (options.type === 'image') {
				return await this.generateImage(options);
			} else if (options.type === 'audio') {
				return await this.generateAudio(options);
			}
			throw new Error(`Unsupported media type: ${options.type}`);
		} catch (error) {
			return {
				success: false,
				error: error.message,
			};
		}
	}

	/**
	 * Generate an image using DALL-E
	 */
	private async generateImage(
		options: MediaGenerationOptions
	): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
		try {
			const response = await generateImage({
				model: openai.ImageGenerator({
					model: (options.model || 'dall-e-3') as 'dall-e-3' | 'dall-e-2',
					size: (options.size || '1024x1024') as
						| '1024x1024'
						| '256x256'
						| '512x512'
						| '1792x1024'
						| '1024x1792',
					quality: (options.quality || 'standard') as 'standard' | 'hd',
				}),
				prompt: options.prompt,
			});

			return {
				success: true,
				data: response.buffer,
			};
		} catch (error) {
			logger.error('Error generating image:', error);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	/**
	 * Generate audio using OpenAI TTS
	 */
	private async generateAudio(
		options: MediaGenerationOptions
	): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
		try {
			const response = await generateSpeech({
				model: openai.SpeechGenerator({
					model: (options.model || 'tts-1') as OpenAISpeechModelType,
					voice: (options.voice || 'alloy') as OpenAISpeechVoice,
				}),
				text: options.prompt,
			});

			return {
				success: true,
				data: response.buffer,
			};
		} catch (error) {
			logger.error('Error generating audio:', error);
			return {
				success: false,
				error: error.message,
			};
		}
	}

	/**
	 * Get a media file by path
	 */
	getMediaFile(filePath: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		return file instanceof TFile ? file : null;
	}

	/**
	 * Delete a media file
	 */
	async deleteMediaFile(filePath: string): Promise<boolean> {
		try {
			const file = this.getMediaFile(filePath);
			if (file) {
				await this.app.vault.delete(file);
				return true;
			}
			return false;
		} catch (error) {
			logger.error('Error deleting media file:', error);
			return false;
		}
	}
}
