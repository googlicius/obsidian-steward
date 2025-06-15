import { App, TFile } from 'obsidian';
import { logger } from '../utils/logger';
import {
  generateImage,
  generateSpeech,
  openai,
  OpenAISpeechVoice,
  elevenlabs,
  SpeechGenerationModel,
} from 'modelfusion';
import { OpenAISpeechModel } from 'src/lib/modelfusion/overridden/OpenAISpeechModel';
import { SearchService } from 'src/solutions/search/searchService';
import { AbortService } from 'src/services/AbortService';

const abortService = AbortService.getInstance();

export interface MediaGenerationOptions {
  prompt: string;
  instructions?: string;
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

type AudioModelType = 'openai' | 'elevenlabs';
const audioModels: Record<AudioModelType, (voice: string) => SpeechGenerationModel> = {
  openai: (voice: string) =>
    new OpenAISpeechModel({
      model: 'tts-1',
      voice: voice as OpenAISpeechVoice,
    }),
  elevenlabs: (voice: string) =>
    elevenlabs.SpeechGenerator({
      model: 'eleven_turbo_v2',
      voice,
      // Add any ElevenLabs specific options here
    }),
};

export class MediaTools {
  private readonly mediaFolder: string;
  private static instance: MediaTools | null = null;

  /**
   * Get the singleton instance of MediaTools
   * @param app The Obsidian App instance
   * @returns MediaTools instance
   */
  public static getInstance(app: App): MediaTools {
    if (!MediaTools.instance) {
      MediaTools.instance = new MediaTools(app);
    }
    return MediaTools.instance;
  }

  private constructor(private readonly app: App) {
    this.mediaFolder = this.getAttachmentsFolderPath();
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
   * Find a file by name or path
   * @param nameOrPath - File name or path
   * @returns The found TFile or null if not found
   */
  async findFileByNameOrPath(nameOrPath: string): Promise<TFile | null> {
    // Strategy 1: Try direct path lookup
    let file = this.app.vault.getAbstractFileByPath(nameOrPath);
    if (file instanceof TFile) {
      return file;
    }

    // Strategy 2: Check if it's in the media folder
    file = this.app.vault.getAbstractFileByPath(`${this.mediaFolder}/${nameOrPath}`);
    if (file instanceof TFile) {
      return file;
    }

    // Strategy 3: If it's a path with directories, extract the filename
    const filename = nameOrPath.includes('/')
      ? nameOrPath.split('/').pop() || nameOrPath
      : nameOrPath;

    // Strategy 4: Use the search service to find the document by name
    try {
      const searchService = SearchService.getInstance();
      const doc = await searchService.searchEngine.getDocumentByName(filename);
      if (doc && doc.path) {
        const file = this.app.vault.getAbstractFileByPath(doc.path);
        if (file instanceof TFile) {
          return file;
        }
      }
    } catch (e) {
      logger.error('Error using searchService in findFileByNameOrPath:', e);
    }

    return null;
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
        run: {
          abortSignal: abortService.createAbortController('generateImage'),
        },
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
   * Generate audio using OpenAI TTS or ElevenLabs
   */
  private async generateAudio(
    options: MediaGenerationOptions
  ): Promise<{ success: boolean; data?: ArrayBuffer; error?: string }> {
    try {
      const modelType = (options.model || 'openai') as AudioModelType;
      const generatorFactory = audioModels[modelType];

      if (!generatorFactory) {
        throw new Error(`Unsupported audio model: ${modelType}`);
      }

      const response = await generateSpeech({
        model: generatorFactory(options.voice || 'alloy').withSettings({
          ...(options.instructions && {
            instructions: options.instructions,
          }),
        } as any),
        run: {
          abortSignal: abortService.createAbortController('generateSpeech'),
        },
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
   * Delete a media file
   */
  async deleteMediaFile(filePath: string): Promise<boolean> {
    try {
      const file = await this.findFileByNameOrPath(filePath);
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
