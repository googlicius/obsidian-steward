import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { extractAudioQuery } from 'src/lib/modelfusion/extractions';
import { MediaTools } from 'src/tools/mediaTools';
import { ArtifactType } from 'src/services/ConversationArtifactManager';

import type StewardPlugin from 'src/main';

export class AudioCommandHandler extends CommandHandler {
  private mediaTools: MediaTools;
  isContentRequired = true;

  constructor(public readonly plugin: StewardPlugin) {
    super();
    this.mediaTools = MediaTools.getInstance(plugin.app);
  }

  /**
   * Render the loading indicator for the audio command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.generatingAudio'));
  }

  /**
   * Handle an audio command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command, lang } = params;

    const t = getTranslation(lang);

    try {
      const extraction = await extractAudioQuery(command);

      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        role: 'Steward',
        includeHistory: false,
        lang,
      });

      await this.renderer.addGeneratingIndicator(title, t('conversation.generatingAudio'));

      const model = extraction.model || this.plugin.settings.audio.model;

      // Generate the media with supported options
      const result = await this.mediaTools.generateMedia({
        type: 'audio',
        prompt: extraction.text,
        instructions: command.systemPrompts?.join('\n'),
        model,
        voice: extraction.voice || this.plugin.settings.audio.voices[model],
      });

      const messageId = await this.renderer.updateConversationNote({
        path: title,
        newContent: `\n![[${result.filePath}]]`,
        command: 'audio',
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        this.artifactManager.storeArtifact(title, messageId, {
          type: ArtifactType.MEDIA_RESULTS,
          paths: [result.filePath],
          mediaType: 'audio',
        });

        // Add a System message with the artifact content
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
          artifactContent: result.filePath,
          role: 'System',
          command: 'audio',
        });
      }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error generating audio: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
