import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/solutions/artifact';
import { AbortOperationKeys } from 'src/constants';
import { explanationFragment } from 'src/lib/modelfusion/prompts/fragments';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';

const { getTranslation } = getBundledInternal('i18n');

// Define the Zod schema for speech tool (same as audioExtractionSchema)
export const speechSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text to convert to speech. Focus on the pronunciation not explanation.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type SpeechArgs = z.infer<typeof speechSchema>;

export class Speech {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getSpeechTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: speechSchema,
    });
  }

  /**
   * Handle a speech tool call
   */
  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<SpeechArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const { title } = ctx.agentHandlerParams;
    const t = getTranslation(ctx.lang);

    try {
      // Update conversation with explanation
      await ctx.updateConversationNote({
        newContent: toolCall.input.explanation,
        role: 'Steward',
        includeHistory: false,
      });

      await this.agent.renderer.addGeneratingIndicator(title, t('conversation.generatingAudio'));

      // Generate the audio using the handler's method
      const speechModel = this.agent.plugin.settings.llm.speech.model;
      const provider = speechModel.split(':')[0];
      const voice =
        this.agent.plugin.settings.llm.speech.voices[
          provider as keyof typeof this.agent.plugin.settings.llm.speech.voices
        ];

      const result = await this.generateAudio(title, toolCall.input.text, {
        voice,
        // instructions: params.intent.systemPrompts?.join('\n'), // Not system prompt
        instructions: 'Pronounce the text clearly and naturally.',
      });

      if (!result.success) {
        await ctx.updateConversationNote({
          newContent: `*Error generating audio: ${result.error}*`,
        });

        await this.agent.renderer.serializeToolInvocation({
          path: title,
          command: 'speech',
          handlerId: ctx.handlerId,
          step: ctx.step,
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

      const messageId = await ctx.updateConversationNote({
        newContent: `\n![[${result.filePath}]]`,
        command: 'speech',
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          artifact: {
            artifactType: ArtifactType.MEDIA_RESULTS,
            paths: [result.filePath],
            mediaType: 'audio',
          },
        });
      }

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'speech',
        handlerId: ctx.handlerId,
        step: ctx.step,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'json',
              value: {
                success: true,
                filePath: result.filePath,
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
      await ctx.updateConversationNote({
        newContent: `Error generating audio: ${error instanceof Error ? error.message : String(error)}`,
        role: 'Steward',
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'speech',
        handlerId: ctx.handlerId,
        step: ctx.step,
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
    conversationTitle: string,
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

      const { experimental_generateSpeech } = await getBundledLib('ai');
      const response = await experimental_generateSpeech({
        abortSignal: this.agent.plugin.abortService.createAbortController(
          conversationTitle,
          AbortOperationKeys.AUDIO
        ),
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
