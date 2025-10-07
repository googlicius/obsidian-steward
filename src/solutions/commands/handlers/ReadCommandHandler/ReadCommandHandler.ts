import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type StewardPlugin from 'src/main';
import { toolSystemPrompt } from './contentReadingPrompt';
import { generateText, tool, Message, generateId } from 'ai';
import { contentReadingSchema, ContentReadingArgs } from './zSchemas';
import { ContentReadingResult } from 'src/services/ContentReadingService';
import { logger } from 'src/utils/logger';

export class ReadCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Repair content reading tool call arguments to handle common LLM misinterpretations
   */
  private repairContentReadingToolCallArgs(args: ContentReadingArgs): ContentReadingArgs {
    const modifiedArgs = { ...args };
    if (args.noteName && typeof args.noteName === 'string') {
      const normalizedNoteName = args.noteName.trim().toLowerCase();
      if (['current note', 'this note', 'current', 'current note'].includes(normalizedNoteName)) {
        logger.warn(`Repairing noteName: ${args.noteName} to null`);
        modifiedArgs.noteName = null;
      }
    }

    if (
      args.elementType &&
      !['paragraph', 'table', 'code', 'list', 'blockquote', 'image', 'heading'].includes(
        args.elementType
      )
    ) {
      logger.warn(`Repairing elementType: ${args.elementType} to null`);
      modifiedArgs.elementType = null;
    }

    return modifiedArgs;
  }

  /**
   * Extract reading instructions from a command using LLM
   */
  private async extractReadContent(params: CommandHandlerParams, messages: Message[]) {
    const { command } = params;
    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    return generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('content-reading'),
      system: toolSystemPrompt,
      messages,
      tools: {
        contentReading: tool({
          parameters: contentReadingSchema,
        }),
      },
    });
  }

  /**
   * Render the loading indicator for the read command
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
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
      /**
       * Remaining steps for the LLM to execute
       */
      remainingSteps?: number;
      /**
       * Current position in the toolCalls array
       */
      toolCallIndex?: number;
      /**
       * Messages in this command
       */
      internalMessages?: Message[];
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand } = params;
    const t = getTranslation(params.lang);

    if (typeof options.internalMessages === 'undefined') {
      options.internalMessages = [{ role: 'user', content: command.query, id: generateId() }];
    }

    type ExtractReadContentResult = Awaited<ReturnType<typeof this.extractReadContent>>;

    try {
      const readTypeMatches = command.query.match(/read type:/g);
      const notesToRead = readTypeMatches ? readTypeMatches.length : 0;

      // Set maxSteps based on the notesToRead to skip the last evaluation step
      const maxSteps = notesToRead > 0 ? notesToRead : 5;

      // Use maxSteps as the default for remainingSteps if not provided
      const remainingSteps =
        options.remainingSteps !== undefined ? options.remainingSteps : maxSteps;

      if (remainingSteps <= 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error: I have reached the maximum number of steps.*`,
          lang: params.lang,
        });
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('The read command has reached the maximum number of steps'),
        };
      }

      const extraction =
        (options.extraction as ExtractReadContentResult) ||
        (await this.extractReadContent(params, options.internalMessages));

      // If there's text and no more steps or no next command, update conversation
      if (extraction.text) {
        if (!nextCommand || extraction.steps.length === 0) {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: extraction.text,
            command: 'read',
            lang: params.lang,
          });
        }
      }

      // Process tool calls starting from the current index
      const startIndex = options.toolCallIndex || 0;

      const toolResults = [];
      const toolInvocationArtifactRefs = [];

      for (let i = startIndex; i < extraction.toolCalls.length; i++) {
        const toolCall = extraction.toolCalls[i];
        if (toolCall.toolName === 'contentReading') {
          toolCall.args = this.repairContentReadingToolCallArgs(toolCall.args);

          // Check if readType is 'entire' and needs confirmation
          if (toolCall.args.readType === 'entire' && !options.readEntireConfirmed) {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: t('read.readEntireContentConfirmation', {
                noteName: toolCall.args.noteName || t('common.thisNote'),
              }),
              command: 'read',
              lang: params.lang,
            });

            return {
              status: CommandResultStatus.NEEDS_CONFIRMATION,
              onConfirmation: () => {
                return this.handle(params, {
                  extraction,
                  readEntireConfirmed: true,
                  remainingSteps,
                  toolCallIndex: i,
                  internalMessages: options.internalMessages,
                });
              },
            };
          }

          // Execute the content reading
          let result: ContentReadingResult | string;
          try {
            result = await this.plugin.contentReadingService.readContent(toolCall.args);
          } catch (error) {
            result = error.message as string;
          }

          toolResults.push({
            ...toolCall,
            result,
          });

          // Process the result
          if (typeof result === 'string') {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: `*${result}*`,
            });
            continue;
          }

          // Update conversation with the explanation for this specific result
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.explanation,
            role: 'Steward',
            command: 'read',
            includeHistory: false,
            lang: params.lang,
          });

          // Show found placeholder if available
          if (toolCall.args.foundPlaceholder) {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: toolCall.args.foundPlaceholder.replace(
                '{{number}}',
                result.blocks.length.toString()
              ),
              includeHistory: false,
            });
          }

          // Display each block
          if (!nextCommand) {
            for (const block of result.blocks) {
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
                    path: result.file?.path,
                  }
                ),
                includeHistory: false,
              });
            }
          }

          const artifactId = await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
            text: `*${t('common.artifactCreated', { type: ArtifactType.READ_CONTENT })}*`,
            artifact: {
              artifactType: ArtifactType.READ_CONTENT,
              readingResult: result,
            },
          });

          toolInvocationArtifactRefs.push({
            ...toolCall,
            result: `artifactRef:${artifactId}`,
          });
        }
      }

      if (toolInvocationArtifactRefs.length > 0) {
        await this.renderer.serializeToolInvocation({
          path: title,
          command: 'read',
          toolInvocations: toolInvocationArtifactRefs,
        });
      }

      // If there are more toolCalls, continue
      if (extraction.toolCalls.length > 0) {
        // Calculate remaining steps
        const newRemainingSteps =
          remainingSteps > 0 ? remainingSteps - extraction.toolCalls.length : 0;

        // Continue handling if there are steps remaining
        if (newRemainingSteps > 0) {
          await this.renderIndicator(title, params.lang);

          // Keep track of the assistant's requests and the user's responses for tool calls
          options.internalMessages.push({
            id: extraction.response.id,
            content: '',
            parts: toolResults.map(item => ({
              type: 'tool-invocation',
              toolInvocation: {
                ...item,
                state: 'result',
              },
            })),
            role: 'assistant',
          });

          return this.handle(params, {
            remainingSteps: newRemainingSteps,
            readEntireConfirmed: options.readEntireConfirmed,
            // Reset the index for the next batch of tool calls
            toolCallIndex: 0,
            internalMessages: options.internalMessages,
          });
        }
      }

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
