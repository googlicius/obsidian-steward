import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { experimental_generateSpeech } from 'ai';
import { getTranslation } from 'src/i18n';
import { extractAudioQuery } from 'src/lib/modelfusion/extractions';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import { StewardPluginSettings } from 'src/types/interfaces';

export class AudioCommandHandler extends CommandHandler {
  isContentRequired = true;

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the audio command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.generatingAudio'));
  }

  private async shouldUpdateTitle(title: string): Promise<boolean> {
    try {
      // Get all messages from the conversation
      const messages = await this.renderer.extractAllConversationMessages(title);

      // If there are only 1 message (user)
      if (messages.length === 1 && messages[0].role === 'user' && messages[0].command === 'audio') {
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle an audio command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { command, lang } = params;

    const t = getTranslation(lang);

    let title = params.title;

    try {
      title =
        params.title !== 'Audio' && (await this.shouldUpdateTitle(title))
          ? await this.renderer.updateTheTitle(params.title, 'Audio')
          : params.title;

      const extraction = await extractAudioQuery(command);

      await this.renderer.updateConversationNote({
        path: title,
        newContent: extraction.explanation,
        role: 'Steward',
        includeHistory: false,
        lang,
      });

      await this.renderer.addGeneratingIndicator(title, t('conversation.generatingAudio'));

      // Generate the audio using the handler's method
      const speechModel = this.plugin.settings.llm.speech.model;
      const provider = speechModel.split(':')[0];
      const voice =
        this.plugin.settings.llm.speech.voices[
          provider as keyof StewardPluginSettings['llm']['speech']['voices']
        ];

      const result = await this.generateAudio(extraction.text, {
        voice,
        instructions: command.systemPrompts?.join('\n'),
      });

      if (!result.success) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error generating audio: ${result.error}*`,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: result.error,
        };
      }

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

        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
          artifactContent: result.filePath,
          command: 'audio',
          role: {
            name: 'Assistant',
            showLabel: false,
          },
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

  private async generateAudio(
    text: string,
    options?: {
      voice?: string;
      instructions?: string;
    }
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      await this.plugin.mediaTools.ensureMediaFolderExists();

      const timestamp = Date.now();
      const filename = this.plugin.mediaTools.getMediaFilename(text, 'audio', timestamp);
      const extension = 'mp3';

      // Get speech configuration from LLM service
      const speechConfig = await this.plugin.llmService.getSpeechConfig();

      // Generate the speech
      const response = await experimental_generateSpeech({
        abortSignal: this.plugin.abortService.createAbortController('audio'),
        ...speechConfig,
        ...options,
        text,
      });

      if (!response.audio) {
        return {
          success: false,
          error: 'Failed to generate speech - no audio received',
        };
      }

      // Get the Uint8Array from the generated audio
      const uint8Array = response.audio.uint8Array;

      // Save the generated audio to a file
      const filePath = `${this.plugin.mediaTools.getAttachmentsFolderPath()}/${filename}.${extension}`;
      await this.plugin.app.vault.createBinary(filePath, uint8Array.buffer as ArrayBuffer);

      return {
        success: true,
        filePath,
      };
    } catch (error) {
      logger.error('Error generating audio:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
