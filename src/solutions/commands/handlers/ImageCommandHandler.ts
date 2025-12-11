import { CommandHandler, CommandHandlerParams, CommandResult } from '../CommandHandler';
import { experimental_generateImage } from 'ai';
import { getTranslation } from 'src/i18n';
import { extractImageQuery } from 'src/lib/modelfusion/extractions';
import { ArtifactType } from 'src/solutions/artifact';
import { logger } from 'src/utils/logger';

import type StewardPlugin from 'src/main';
import { IntentResultStatus } from '../types';

export class ImageCommandHandler extends CommandHandler {
  isContentRequired = true;

  constructor(public readonly plugin: StewardPlugin) {
    super();
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
    const { title, intent, lang } = params;

    const t = getTranslation(lang);

    try {
      const extraction = await extractImageQuery(intent);

      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        role: 'Steward',
        includeHistory: false,
        lang,
      });

      if (extraction.confidence <= 0.7) {
        // Return LOW_CONFIDENCE status to trigger context augmentation
        return {
          status: IntentResultStatus.LOW_CONFIDENCE,
          intentType: 'image',
          explanation: extraction.explanation,
        };
      }

      await this.renderer.addGeneratingIndicator(title, t('conversation.generatingImage'));

      // Generate the image using the handler's method
      const result = await this.generateImage(extraction.text);

      if (!result.success) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error generating image: ${result.error}*`,
        });

        return {
          status: IntentResultStatus.ERROR,
          error: result.error,
        };
      }

      const messageId = await this.renderer.updateConversationNote({
        path: title,
        newContent: `\n![[${result.filePath}]]`,
        command: 'image',
        lang,
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        const t = getTranslation(lang);
        await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          text: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
          artifact: {
            artifactType: ArtifactType.MEDIA_RESULTS,
            paths: [result.filePath],
            mediaType: 'image',
          },
        });
      }

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error generating image: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }

  private async generateImage(
    prompt: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      await this.plugin.mediaTools.ensureMediaFolderExists();

      const timestamp = Date.now();
      const filename = this.plugin.mediaTools.getMediaFilename(prompt, 'image', timestamp);
      const extension = 'png';

      // Get image configuration from LLM service
      const imageConfig = await this.plugin.llmService.getImageConfig();

      // Generate the image
      const response = await experimental_generateImage({
        abortSignal: this.plugin.abortService.createAbortController('image'),
        ...imageConfig,
        prompt,
      });

      if (!response.image) {
        return {
          success: false,
          error: 'Failed to generate image - no image received',
        };
      }

      // Get the Uint8Array from the generated image
      const uint8Array = response.image.uint8Array;

      // Save the generated image to a file
      const filePath = `${this.plugin.mediaTools.getAttachmentsFolderPath()}/${filename}.${extension}`;
      await this.plugin.app.vault.createBinary(filePath, uint8Array.buffer as ArrayBuffer);

      return {
        success: true,
        filePath,
      };
    } catch (error) {
      logger.error('Error generating image:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
