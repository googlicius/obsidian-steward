import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import type StewardPlugin from 'src/main';
import { toolSystemPrompt } from 'src/lib/modelfusion/prompts/contentReadingPrompt';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { z } from 'zod';
import { generateText, tool } from 'ai';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';

const contentReadingSchema = z.object({
  readType: z.enum(['above', 'below', 'entire']).default('above')
    .describe(`- "above": Refers to content above the cursor
- "below": Refers to content below the cursor
- "entire": Refers to the entire content of the note`),
  noteName: z
    .string()
    .nullable()
    .default(null)
    .describe(`Name of the note to read from. If not specified, leave it blank`),
  elementType: z.string().nullable().default(null).describe(`Identify element types if mentioned:
- One or many of "paragraph", "table", "code", "list", "blockquote", "image", or null if no specific element type is mentioned
- For multiple types:
  - Use comma-separated values for OR conditions (e.g., "paragraph, table")
  - Use "+" for AND conditions (e.g., "paragraph+table")`),
  blocksToRead: z.number().min(-1).default(1)
    .describe(`Number of blocks to read (paragraphs, tables, code blocks, etc.)
- Set to -1 ONLY if the user mentions "all content"
- Otherwise, extract the number from the query if specified`),
  foundPlaceholder: z
    .string()
    .nullable()
    .describe(
      `A short text to indicate that the content was found. MUST include the term {{number}} as a placeholder, for example: "I found {{number}}..."
If the readType is "entire", leave it null.`
    ),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  explanation: z.string().describe(explanationFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type ContentReadingArgs = z.infer<typeof contentReadingSchema>;

export class ReadCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Extract reading instructions from a command using LLM
   */
  private async extractReadContent(params: CommandHandlerParams) {
    const { command, title, nextCommand } = params;
    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    return generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('content-reading'),
      system: toolSystemPrompt,
      prompt: command.query,
      maxSteps: 5,
      tools: {
        contentReading: tool({
          parameters: contentReadingSchema,
          execute: async args => {
            try {
              return await this.plugin.contentReadingService.readContent(args);
            } catch (error) {
              return error.message as string;
            }
          },
        }),
      },
      onStepFinish: async step => {
        const lang = params.lang;
        const t = getTranslation(lang);

        // Get all content reading tool calls
        const contentReadingCalls = step.toolResults.filter(
          call => call.toolName === 'contentReading'
        );

        // Process each content reading tool call
        for (const toolCall of contentReadingCalls) {
          const args = toolCall.args as ContentReadingArgs;

          if (typeof toolCall.result === 'string') {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: `*${toolCall.result}*`,
            });
            continue;
          }

          // Update conversation with the explanation for this specific result
          const messageId = await this.renderer.updateConversationNote({
            path: title,
            newContent: args.explanation,
            role: 'Steward',
            command: 'read',
            includeHistory: false,
            lang,
          });

          // Show found placeholder if available
          if (args.foundPlaceholder) {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: args.foundPlaceholder.replace(
                '{{number}}',
                toolCall.result.blocks.length.toString()
              ),
            });
          }

          // Display each block
          if (!nextCommand) {
            for (const block of toolCall.result.blocks) {
              const endLine = this.plugin.editor.getLine(block.endLine);
              await this.renderer.updateConversationNote({
                path: title,
                newContent: this.plugin.noteContentService.formatCallout(
                  block.content,
                  'stw-search-result',
                  {
                    startLine: block.startLine,
                    endLine: block.endLine,
                    start: 0,
                    end: endLine.length,
                    path: toolCall.result.file?.path,
                  }
                ),
              });
            }
          }

          // Store the artifact for this result
          if (messageId) {
            this.artifactManager.storeArtifact(title, messageId, {
              type: ArtifactType.READ_CONTENT,
              readingResult: toolCall.result,
            });

            await this.renderer.updateConversationNote({
              path: title,
              newContent: `*${t('common.artifactCreated', { type: ArtifactType.READ_CONTENT })}*`,
              artifactContent: toolCall.result.blocks.map(block => block.content).join('\n\n'),
              command: 'read',
              role: {
                name: 'Assistant',
                showLabel: false,
              },
            });
          }
        }

        await this.renderIndicator(title, lang);
      },
    });
  }

  /**
   * Render the loading indicator for the read command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.readingContent'));
  }

  /**
   * Handle a read command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      /**
       * The extraction result from the LLM before confirmation
       */
      extraction?: unknown;
      /**
       * Whether the user has confirmed reading the entire content
       */
      readEntireConfirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, nextCommand } = params;

    type ExtractReadContentResult = Awaited<ReturnType<typeof this.extractReadContent>>;

    try {
      const extraction =
        (options.extraction as ExtractReadContentResult) || (await this.extractReadContent(params));

      if (!nextCommand && extraction.text) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.text,
          command: 'read',
          lang: params.lang,
        });
      }

      // Check if any tool call is for entire content and needs confirmation
      // Note: This code is kept as requested but is currently commented out
      // const entireContentReadCall = contentReadingToolCalls.find(
      //   toolCall => toolCall.args.readType === 'entire'
      // );

      // if (entireContentReadCall && !options.readEntireConfirmed) {
      //   await this.renderer.updateConversationNote({
      //     path: title,
      //     newContent: t('read.readEntireContentConfirmation', {
      //       noteName: entireContentReadCall.args.noteName,
      //     }),
      //     role: 'Steward',
      //     command: 'read',
      //     lang,
      //   });

      //   return {
      //     status: CommandResultStatus.NEEDS_CONFIRMATION,
      //     onConfirmation: () => {
      //       return this.handle(params, { extraction, readEntireConfirmed: true });
      //     },
      //   };
      // }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error reading content: ${error.message}*`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
