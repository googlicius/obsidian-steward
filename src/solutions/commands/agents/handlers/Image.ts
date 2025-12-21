import { tool } from 'ai';
import { z } from 'zod';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolInvocation } from '../../tools/types';
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
    parameters: imageSchema,
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
    options: { toolCall: ToolInvocation<unknown, ImageArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('Image.handle invoked without handlerId');
    }

    try {
      // Update conversation with explanation
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        role: 'Steward',
        includeHistory: false,
        lang,
        handlerId,
      });

      // Check confidence level
      if (toolCall.args.confidence <= 0.7) {
        // Return LOW_CONFIDENCE status to trigger context augmentation
        return {
          status: IntentResultStatus.LOW_CONFIDENCE,
          intentType: 'image',
          explanation: toolCall.args.explanation,
        };
      }

      await this.agent.renderer.addGeneratingIndicator(title, t('conversation.generatingImage'));

      // Generate the image using the handler's method
      const result = await this.generateImage(toolCall.args.text);

      if (!result.success) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: `*Error generating image: ${result.error}*`,
          handlerId,
        });

        await this.agent.renderer.serializeToolInvocation({
          path: title,
          command: 'image',
          handlerId,
          toolInvocations: [
            {
              ...toolCall,
              result: {
                error: result.error,
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
        path: title,
        newContent: `\n![[${result.filePath}]]`,
        command: 'image',
        handlerId,
        lang,
      });

      // Store the media artifact
      if (messageId && result.filePath) {
        await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          text: `*${t('common.artifactCreated', { type: ArtifactType.MEDIA_RESULTS })}*`,
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
        handlerId,
        toolInvocations: [
          {
            ...toolCall,
            result: {
              success: true,
              filePath: result.filePath,
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
        path: title,
        newContent: `Error generating image: ${error instanceof Error ? error.message : String(error)}`,
        role: 'Steward',
        handlerId,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'image',
        handlerId,
        toolInvocations: [
          {
            ...toolCall,
            result: {
              error: error instanceof Error ? error.message : String(error),
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
