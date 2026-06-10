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

// Define the Zod schema for image tool (same as imageExtractionSchema)
export const imageSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text prompt that describes the image to generate.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  lang: z.string().nullable().optional().describe(userLanguagePrompt.content),
});

export type ImageArgs = z.infer<typeof imageSchema>;

export class Image {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getImageTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: imageSchema,
    });
  }

  /**
   * Handle an image tool call
   */
  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<ImageArgs> }
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

      await this.agent.renderer.addGeneratingIndicator(title, t('conversation.generatingImage'));

      // Generate the image using the handler's method
      const result = await this.generateImage(title, toolCall.input.text);

      if (!result.success) {
        await ctx.updateConversationNote({
          newContent: `*Error generating image: ${result.error}*`,
        });

        await this.agent.renderer.serializeToolInvocation({
          path: title,
          command: 'image',
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
        command: 'image',
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          artifact: {
            artifactType: ArtifactType.MEDIA_RESULTS,
            paths: [result.filePath],
            mediaType: 'image',
          },
        });
      }

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'image',
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
      logger.error('Error generating image:', error);
      await ctx.updateConversationNote({
        newContent: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
        role: 'Steward',
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'image',
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

  private async generateImage(
    conversationTitle: string,
    prompt: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      await this.agent.plugin.mediaTools.ensureMediaFolderExists();

      const timestamp = Date.now();
      const filename = this.agent.plugin.mediaTools.getMediaFilename(prompt, 'image', timestamp);
      const extension = 'png';

      // Get image configuration from LLM service
      const imageConfig = await this.agent.plugin.llmService.getImageConfig();

      const { generateImage } = await getBundledLib('ai');
      const response = await generateImage({
        abortSignal: this.agent.plugin.abortService.createAbortController(
          conversationTitle,
          AbortOperationKeys.IMAGE
        ),
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
      const filePath = `${this.agent.plugin.mediaTools.getAttachmentsFolderPath()}/${filename}.${extension}`;
      await this.agent.app.vault.createBinary(filePath, uint8Array.buffer as ArrayBuffer);

      return {
        success: true,
        filePath,
      };
    } catch (error) {
      logger.error('Error generating image:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
