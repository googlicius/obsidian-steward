import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus, Intent } from '../../types';
import { ContentReadingResult } from 'src/services/ContentReadingService';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { logger } from 'src/utils/logger';

export const contentReadingSchema = z.object({
  readType: z.enum(['above', 'below', 'entire']).default('above')
    .describe(`- "above", "below": Refers to the direction to read from current position.
- "entire": Refers to the entire content of the file.`),
  fileName: z
    .string()
    .nullable()
    .default(null)
    .describe(`Name of the file to read from. If not specified, leave it blank`)
    .transform(value => {
      if (value === null) return null;

      const normalizedValue = value.trim().toLowerCase();

      // Check if the value is a reference to the current note
      if (['current note', 'this note', 'current'].includes(normalizedValue)) {
        logger.warn(`noteName "${value}" refers to current note. Setting to null.`);
        return null;
      }

      return value;
    }),
  elementType: z
    .enum(['paragraph', 'table', 'code', 'list', 'blockquote', 'image', 'heading'])
    .nullable()
    .default('paragraph')
    .describe(
      `Identify the element type if mentioned.
If the mentioned element is NOT one of the predefined types, classify it as "paragraph" so it could be any element closest to the current position.`
    ),
  blocksToRead: z.number().min(-1).default(1).describe(`Number of blocks to read
Set to -1 when:
- The user requests to read entire content.
- Reading above or below the cursor and explicitly requesting reading all content from the current position.`),
  startLine: z
    .number()
    .nullable()
    .default(null)
    .describe(
      `Specific line number to start reading from (0-based). Leave null to use cursor position.`
    ),
  foundPlaceholder: z
    .string()
    .optional()
    .nullable()
    .describe(
      `A short text to indicate that the content was found. MUST include the term {{number}} as a placeholder, for example: "I found {{number}}..."
If the readType is "entire", leave it null.`
    ),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  explanation: z.string().describe(explanationFragment),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type ContentReadingArgs = z.infer<typeof contentReadingSchema>;

export class ReadContent {
  private static readonly contentReadingTool = tool({ parameters: contentReadingSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getContentReadingTool() {
    return ReadContent.contentReadingTool;
  }

  /**
   * Handle content reading tool call in the agent
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, ContentReadingArgs>; nextIntent?: Intent }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall, nextIntent } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('ReadContent.handle invoked without handlerId');
    }

    // Execute the content reading
    let result: ContentReadingResult | string;
    try {
      result = await this.agent.plugin.contentReadingService.readContent(toolCall.args);
    } catch (error) {
      logger.error('Error in content reading', error);
      result = error instanceof Error ? error.message : String(error);
    }

    // Process the result
    if (typeof result === 'string') {
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${result}*`,
        command: 'read',
        includeHistory: false,
        handlerId,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'read',
        handlerId,
        toolInvocations: [
          {
            ...toolCall,
            result: `messageRef:${messageId}`,
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    if (result.blocks.length === 0) {
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('read.noContentFound')}*`,
        command: 'read',
        includeHistory: false,
        handlerId,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'read',
        handlerId,
        toolInvocations: [
          {
            ...toolCall,
            result: `messageRef:${messageId}`,
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: toolCall.args.explanation,
      command: 'read',
      includeHistory: false,
      lang: params.lang,
      handlerId,
    });

    // Show found placeholder if available
    if (toolCall.args.foundPlaceholder) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.foundPlaceholder.replace(
          '{{number}}',
          result.blocks.length.toString()
        ),
        includeHistory: false,
        handlerId,
      });
    }

    // Display each block
    if (!nextIntent || nextIntent.type === 'read') {
      for (const block of result.blocks) {
        if (block.content === '') {
          continue;
        }

        const endLine = this.agent.plugin.editor.getLine(block.endLine);
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: this.agent.plugin.noteContentService.formatCallout(
            block.content,
            'stw-search-result',
            {
              startLine: block.startLine,
              endLine: block.endLine,
              start: 0,
              end: endLine.length,
              path: result.file?.path,
            }
          ),
          includeHistory: false,
          handlerId,
        });
      }
    }

    const artifactId = await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
      text: `*${t('common.artifactCreated', { type: ArtifactType.READ_CONTENT })}*`,
      artifact: {
        artifactType: ArtifactType.READ_CONTENT,
        readingResult: result,
      },
    });

    // Store the artifact reference for successful reads
    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'read',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result: `artifactRef:${artifactId}`,
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
