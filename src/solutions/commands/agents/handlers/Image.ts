import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { experimental_generateImage } from 'ai';
import { ArtifactType } from 'src/solutions/artifact';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';

// Define the Zod schema for image tool (same as imageExtractionSchema)
const imageSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text prompt that describes the image to generate.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
});

export type ImageArgs = z.infer<typeof imageSchema>;

export class Image {
  private static readonly imageTool = tool({
    inputSchema: imageSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getImageTool() {
    return Image.imageTool;
  }

  /**
   * Render the loading indicator for the image command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.agent.renderer.addGeneratingIndicator(title, t('conversation.generatingImage'));
  }

  /**
   * Handle an image tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<ImageArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const t = getTranslation(params.lang);

    if (!params.handlerId) {
      throw new Error('Image.handle invoked without handlerId');
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
        step: params.invocationCount,
      });

      // Check confidence level
      if (toolCall.input.confidence <= 0.7) {
        // Return LOW_CONFIDENCE status to trigger context augmentation
        return {
          status: IntentResultStatus.LOW_CONFIDENCE,
          intentType: 'image',
          explanation: toolCall.input.explanation,
        };
      }

      await this.agent.renderer.addGeneratingIndicator(
        params.title,
        t('conversation.generatingImage')
      );

      // Generate the image using the handler's method
      const result = await this.generateImage(toolCall.input.text);

      if (!result.success) {
        await this.agent.renderer.updateConversationNote({
          path: params.title,
          newContent: `*Error generating image: ${result.error}*`,
          handlerId: params.handlerId,
          step: params.invocationCount,
        });

        await this.agent.renderer.serializeToolInvocation({
          path: params.title,
          command: 'image',
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
        command: 'image',
        handlerId: params.handlerId,
        step: params.invocationCount,
        lang: params.lang,
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        await this.agent.plugin.artifactManagerV2.withTitle(params.title).storeArtifact({
          text: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
          artifact: {
            artifactType: ArtifactType.MEDIA_RESULTS,
            paths: [result.filePath],
            mediaType: 'image',
          },
        });
      }

      await this.agent.renderer.serializeToolInvocation({
        path: params.title,
        command: 'image',
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
                filePath: result.filePath!, // Non-null assertion: filePath is always defined when success is true
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
      await this.agent.renderer.updateConversationNote({
        path: params.title,
        newContent: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
        role: 'Steward',
        handlerId: params.handlerId,
        step: params.invocationCount,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: params.title,
        command: 'image',
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

  private async generateImage(
    prompt: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      await this.agent.plugin.mediaTools.ensureMediaFolderExists();

      const timestamp = Date.now();
      const filename = this.agent.plugin.mediaTools.getMediaFilename(prompt, 'image', timestamp);
      const extension = 'png';

      // Get image configuration from LLM service
      const imageConfig = await this.agent.plugin.llmService.getImageConfig();

      // Generate the image
      const response = await experimental_generateImage({
        abortSignal: this.agent.plugin.abortService.createAbortController('image'),
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
