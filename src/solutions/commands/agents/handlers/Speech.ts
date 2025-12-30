import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { experimental_generateSpeech } from 'ai';
import { ArtifactType } from 'src/solutions/artifact';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';

// Define the Zod schema for speech tool (same as audioExtractionSchema)
const speechSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text to convert to speech. Focus on the pronunciation not explanation.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
});

export type SpeechArgs = z.infer<typeof speechSchema>;

export class Speech {
  private static readonly speechTool = tool({
    inputSchema: speechSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getSpeechTool() {
    return Speech.speechTool;
  }

  /**
   * Render the loading indicator for the speech command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.agent.renderer.addGeneratingIndicator(title, t('conversation.generatingAudio'));
  }

  /**
   * Handle a speech tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<SpeechArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const t = getTranslation(params.lang);

    if (!params.handlerId) {
      throw new Error('Speech.handle invoked without handlerId');
    }

    try {
      // Update conversation with explanation
      await this.agent.renderer.updateConversationNote({
        path: params.title,
        newContent: toolCall.input.explanation,
        role: 'Steward',
        includeHistory: false,
        lang: params.lang,
        handlerId: params.handlerId,
      });

      await this.agent.renderer.addGeneratingIndicator(
        params.title,
        t('conversation.generatingAudio')
      );

      // Generate the audio using the handler's method
      const speechModel = this.agent.plugin.settings.llm.speech.model;
      const provider = speechModel.split(':')[0];
      const voice =
        this.agent.plugin.settings.llm.speech.voices[
          provider as keyof typeof this.agent.plugin.settings.llm.speech.voices
        ];

      const result = await this.generateAudio(toolCall.input.text, {
        voice,
        instructions: params.intent.systemPrompts?.join('\n'),
      });

      if (!result.success) {
        await this.agent.renderer.updateConversationNote({
          path: params.title,
          newContent: `*Error generating audio: ${result.error}*`,
          handlerId: params.handlerId,
          step: params.invocationCount,
        });

        await this.agent.renderer.serializeToolInvocation({
          path: params.title,
          command: 'speech',
          handlerId: params.handlerId,
          step: params.invocationCount,
          toolInvocations: [
            {
              ...toolCall,
              type: 'tool-result',
              output: {
                type: 'error-text',
                value: result.error ?? 'Unknown error',
              },
            },
          ],
        });

        return {
          status: IntentResultStatus.ERROR,
          error: result.error,
        };
      }

      const messageId = await this.agent.renderer.updateConversationNote({
        path: params.title,
        newContent: `\n![[${result.filePath}]]`,
        command: 'speech',
        handlerId: params.handlerId,
        step: params.invocationCount,
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        await this.agent.plugin.artifactManagerV2.withTitle(params.title).storeArtifact({
          text: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
          artifact: {
            artifactType: ArtifactType.MEDIA_RESULTS,
            paths: [result.filePath],
            mediaType: 'audio',
          },
        });
      }

      await this.agent.renderer.serializeToolInvocation({
        path: params.title,
        command: 'speech',
        handlerId: params.handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'json',
              value: {
                success: true,
                filePath: result.filePath!,
              },
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error generating audio:', error);
      await this.agent.renderer.updateConversationNote({
        path: params.title,
        newContent: `Error generating audio: ${error instanceof Error ? error.message : String(error)}`,
        role: 'Steward',
        handlerId: params.handlerId,
        step: params.invocationCount,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: params.title,
        command: 'speech',
        handlerId: params.handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'error-text',
              value: error instanceof Error ? error.message : String(error),
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
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
      await this.agent.plugin.mediaTools.ensureMediaFolderExists();

      const timestamp = Date.now();
      const filename = this.agent.plugin.mediaTools.getMediaFilename(text, 'audio', timestamp);
      const extension = 'mp3';

      // Get speech configuration from LLM service
      const speechConfig = await this.agent.plugin.llmService.getSpeechConfig();

      // Generate the speech
      const response = await experimental_generateSpeech({
        abortSignal: this.agent.plugin.abortService.createAbortController('audio'),
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
      const filePath = `${this.agent.plugin.mediaTools.getAttachmentsFolderPath()}/${filename}.${extension}`;
      await this.agent.app.vault.createBinary(filePath, uint8Array.buffer as ArrayBuffer);

      return {
        success: true,
        filePath,
      };
    } catch (error) {
      logger.error('Error generating audio:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
