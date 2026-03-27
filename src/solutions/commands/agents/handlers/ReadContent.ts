import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { normalizePath } from 'obsidian';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ContentReadingResult } from 'src/services/ContentReadingService';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { logger } from 'src/utils/logger';
import { ARTIFACT_REF_PREFIX } from '../../command-syntax-parser/normalizers/ReadContentInputNormalizer';

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
  constructor(private readonly agent: AgentHandlerContext) {}

  public extractPathsForGuardrails(input: ContentReadingArgs): string[] {
    return input.fileNames.map(f => normalizePath(f));
  }

  public static async getContentReadingTool() {
    const { tool } = await getBundledLib('ai');
    return tool({ inputSchema: contentReadingSchema });
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

    const { fileNames: rawFileNames, ...rest } = toolCall.input;

    const fileNames = await this.resolveFileNames(rawFileNames, title);

    const readingResults: ContentReadingResult[] = [];
    const errors: Array<{ fileName: string | null; error: string }> = [];

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

    // Don't render content when toolCall.input.readType is "entire" or "frontmatter"
    if (toolCall.input.readType !== 'entire' && toolCall.input.readType !== 'frontmatter') {
      const reviewContent = this.buildReviewCalloutContent({
        readingResults,
        input: toolCall.input,
        lang,
      });
      if (reviewContent) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: reviewContent,
          includeHistory: false,
          handlerId,
          step: params.invocationCount,
        });
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

  /**
   * Resolve file names, expanding any `artifact:<id|latest>` entries
   * into actual file paths via the artifact manager.
   */
  private async resolveFileNames(rawFileNames: string[], title: string): Promise<string[]> {
    const resolved: string[] = [];

    for (const name of rawFileNames) {
      if (!name.startsWith(ARTIFACT_REF_PREFIX)) {
        resolved.push(name);
        continue;
      }

      const artifactRef = name.slice(ARTIFACT_REF_PREFIX.length);
      const docs =
        artifactRef === 'latest'
          ? await this.resolveLatestArtifactFiles(title)
          : await this.agent.plugin.artifactManagerV2
              .withTitle(title)
              .resolveFilesFromArtifact(artifactRef);

      if (docs.length === 0) {
        logger.warn(`No files resolved from artifact reference: ${artifactRef}`);
        continue;
      }

      for (const doc of docs) {
        resolved.push(doc.path);
      }
    }

    return resolved;
  }

  private async resolveLatestArtifactFiles(title: string) {
    const ARTIFACT_SUPPORTED_TYPES: ArtifactType[] = [
      ArtifactType.SEARCH_RESULTS,
      ArtifactType.CREATED_PATHS,
      ArtifactType.READ_CONTENT,
      ArtifactType.MEDIA_RESULTS,
      ArtifactType.LIST_RESULTS,
    ];

    const manager = this.agent.plugin.artifactManagerV2.withTitle(title);
    const artifact = await manager.getMostRecentArtifactOfTypes(ARTIFACT_SUPPORTED_TYPES);

    if (!artifact?.id) {
      logger.warn('No recent artifact found for "latest" reference');
      return [];
    }

    return manager.resolveFilesFromArtifact(artifact.id);
  }

  private buildReviewCalloutContent(params: {
    readingResults: ContentReadingResult[];
    input: ContentReadingArgs;
    lang?: string | null;
  }): string {
    const { readingResults, input, lang } = params;
    const t = getTranslation(lang);
    const sections: Array<{ path?: string; content: string }> = [];

    for (const result of readingResults) {
      const blocks: string[] = [];

      for (const block of result.blocks) {
        if (block.content.trim() === '') {
          continue;
        }
        blocks.push(block.content);
      }

      if (blocks.length === 0) {
        continue;
      }

      sections.push({
        path: result.file?.path,
        content: blocks.join('\n\n'),
      });
    }

    if (sections.length === 0) {
      return '';
    }

    const includeFileLinks = sections.length > 1;
    const renderedSections: string[] = [];

    for (const section of sections) {
      if (includeFileLinks && section.path) {
        renderedSections.push(`[[${section.path}]]\n\n${section.content}`);
        continue;
      }
      renderedSections.push(section.content);
    }

    const summaryParts: string[] = [t('read.reviewType', { value: input.readType })];

    if (input.pattern?.trim()) {
      summaryParts.push(t('read.reviewPattern', { value: input.pattern.trim() }));
    }

    const summaryLine = t('read.reviewSummary', { summary: summaryParts.join(', ') });
    const content = `${summaryLine}\n\n${renderedSections.join('\n\n---\n\n')}`;

    return this.agent.plugin.noteContentService.formatCallout(content, 'stw-review');
  }
}
