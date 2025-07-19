import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { extractImageQuery } from 'src/lib/modelfusion/extractions';
import { MediaTools } from 'src/tools/mediaTools';
import { ArtifactType } from 'src/services/ConversationArtifactManager';

import type StewardPlugin from 'src/main';

export class ImageCommandHandler extends CommandHandler {
  private mediaTools: MediaTools;
  isContentRequired = true;

  constructor(public readonly plugin: StewardPlugin) {
    super();
    this.mediaTools = MediaTools.getInstance(plugin.app);
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
    const { title, command, lang } = params;

    const t = getTranslation(lang);

    try {
      const extraction = await extractImageQuery(command);

      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        role: 'Steward',
        includeHistory: false,
        lang,
      });

      // If the confidence is low, just return success
      if (extraction.confidence <= 0.7) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('common.abortedByLowConfidence'),
          includeHistory: false,
          lang,
        });
        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

      await this.renderer.addGeneratingIndicator(title, t('conversation.generatingImage'));

      const model = extraction.model || 'dall-e-3';

      // Generate the media with supported options
      const result = await this.mediaTools.generateMedia({
        type: 'image',
        prompt: extraction.text,
        model,
        size: extraction.size,
        quality: extraction.quality,
      });

      const messageId = await this.renderer.updateConversationNote({
        path: title,
        newContent: `\n![[${result.filePath}]]`,
        command: 'image',
        lang,
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        this.artifactManager.storeArtifact(title, messageId, {
          type: ArtifactType.MEDIA_RESULTS,
          paths: [result.filePath],
          mediaType: 'image',
        });

        // Add a System message with the artifact content
        const t = getTranslation(lang);
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
          artifactContent: result.filePath,
          role: 'System',
          command: 'image',
        });
      }

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
