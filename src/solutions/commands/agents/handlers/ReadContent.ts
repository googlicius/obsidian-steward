import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ContentReadingResult } from 'src/services/ContentReadingService';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { logger } from 'src/utils/logger';

export const contentReadingSchema = z.object({
  readType: z.enum(['above', 'below', 'pattern', 'entire', 'frontmatter']).default('above')
    .describe(`- "above", "below": Refers to the direction to read from current position.
- "pattern": The RegExp pattern to search for in the content.
- "entire": Refers to the entire content of the file.
- "frontmatter": Reads only the YAML frontmatter (properties) of the file. Useful for collecting metadata from multiple notes without reading the entire content.`),
  fileNames: z
    .array(z.string())
    .describe(`Array of file names to read from.`)
    .transform(values => {
      if (!values || values.length === 0) return [];

      return values
        .map(value => {
          const normalizedValue = value.trim().toLowerCase();

          // Check if the value is a reference to the current note
          if (['current note', 'this note', 'current'].includes(normalizedValue)) {
            logger.warn(`noteName "${value}" refers to current note. Filtering out.`);
            return null;
          }

          return value.trim();
        })
        .filter((value): value is string => value !== null);
    }),
  elementType: z
    .enum(['paragraph', 'table', 'code', 'list', 'blockquote', 'image', 'heading'])
    .nullable()
    .default(null)
    .describe(
      `Identify the element type if mentioned.
If the mentioned element is NOT one of the predefined types, specify elementType as NULL that indicates any element closest to the current position.`
    ),
  blocksToRead: z.number().min(-1).default(1).describe(`Number of blocks to read
A block is a consecutive sequence of lines that contains an element (e.g., paragraph, table, code, list, blockquote, image, heading).
Set to 1 if the user doesn't specify the number of blocks.
Set to -1 when: Reading above or below the current position and explicitly requesting reading all content from the current position.`),
  pattern: z
    .string()
    .optional()
    .describe(`RegExp pattern to search for in the content. Required when readType is "pattern".`),
  foundPlaceholder: z
    .string()
    .optional()
    .nullable()
    .describe(
      `A short text to indicate that the content was found. MUST include the term {{number}} as a placeholder, for example: "I found {{number}}..."
If the readType is "entire", leave it null.`
    ),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type ContentReadingArgs = z.infer<typeof contentReadingSchema>;

export class ReadContent {
  private static readonly contentReadingTool = tool({ inputSchema: contentReadingSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getContentReadingTool() {
    return ReadContent.contentReadingTool;
  }

  /**
   * Handle content reading tool call in the agent
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<ContentReadingArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('ReadContent.handle invoked without handlerId');
    }

    const { fileNames, ...rest } = toolCall.input;

    const readingResults: ContentReadingResult[] = [];
    const errors: Array<{ fileName: string | null; error: string }> = [];

    // Read each file
    for (const fileName of fileNames) {
      try {
        const result = await this.agent.plugin.contentReadingService.readContent({
          ...rest,
          fileName,
        });
        readingResults.push(result);
      } catch (error) {
        logger.error(`Error reading content from file: ${fileName ?? 'current file'}`, error);
        errors.push({
          fileName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Handle case where all files failed
    if (errors.length > 0 && readingResults.length === 0) {
      const errorMessages = errors
        .map(e => `${e.fileName ?? 'current file'}: ${e.error}`)
        .join('\n');
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${errorMessages}*`,
        command: 'read',
        includeHistory: false,
        handlerId,
        step: params.invocationCount,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'read',
        handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: `messageRef:${messageId}`,
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    // Show errors for partially failed files
    if (errors.length > 0) {
      const errorMessages = errors
        .map(e => `${e.fileName ?? 'current file'}: ${e.error}`)
        .join('\n');
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${errorMessages}*`,
        command: 'read',
        includeHistory: false,
        handlerId,
        step: params.invocationCount,
      });
    }

    // Calculate total blocks across all results
    const totalBlocks = readingResults.reduce((sum, result) => sum + result.blocks.length, 0);

    // Check if all results have no content (for markdown files)
    const allEmpty = readingResults.every(
      result => result.file && result.file.path.endsWith('.md') && result.blocks.length === 0
    );

    if (allEmpty) {
      const noContentMessage =
        toolCall.input.readType === 'frontmatter'
          ? t('read.noFrontmatterFound')
          : t('read.noContentFound');
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${noContentMessage}*`,
        command: 'read',
        includeHistory: false,
        handlerId,
        step: params.invocationCount,
      });

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'read',
        handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: `messageRef:${messageId}`,
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    // Show found placeholder if available (once for all files)
    if (toolCall.input.foundPlaceholder && totalBlocks > 0) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.foundPlaceholder.replace('{{number}}', totalBlocks.toString()),
        includeHistory: false,
        handlerId,
        step: params.invocationCount,
      });
    }

    // Process each result
    for (const result of readingResults) {
      // Skip empty markdown files
      if (result.file && result.file.path.endsWith('.md') && result.blocks.length === 0) {
        continue;
      }

      // Don't render content when toolCall.input.readType is "entire" or "frontmatter"
      if (toolCall.input.readType !== 'entire' && toolCall.input.readType !== 'frontmatter') {
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
            step: params.invocationCount,
          });
        }
      }
    }

    // Store single artifact with all reading results
    const artifactId = await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
      artifact: {
        artifactType: ArtifactType.READ_CONTENT,
        readingResults,
      },
    });

    // Serialize tool invocation once with artifact reference
    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'read',
      handlerId,
      step: params.invocationCount,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'text',
            value: `artifactRef:${artifactId}`,
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
