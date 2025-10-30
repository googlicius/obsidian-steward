import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { streamText } from 'ai';
import { prepareMessage } from 'src/lib/modelfusion';
import type StewardPlugin from 'src/main';
import { STW_SELECTED_PATTERN } from 'src/constants';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { ReadCommandHandler } from '../ReadCommandHandler/ReadCommandHandler';
import { languageEnforcementFragment } from 'src/lib/modelfusion/prompts/fragments';
import {
  requestReadContentTool,
  REQUEST_READ_CONTENT_TOOL_NAME,
} from '../../tools/requestReadContent';
import { createEditTool, EDIT_TOOL_NAME } from '../../tools/editContent';
import { ToolInvocation } from '../../tools/types';
import { UpdateCommandHandler } from '../UpdateCommandHandler/UpdateCommandHandler';
import { uniqueID } from 'src/utils/uniqueID';
import { SystemPromptModifier } from '../../SystemPromptModifier';
import { ASK_USER_TOOL_NAME, createAskUserTool } from '../../tools/askUser';
import { waitForError } from 'src/utils/waitForError';

const { askUserTool } = createAskUserTool('ask');

export interface ContentUpdate {
  updatedContent: string;
  fromLine: number;
  toLine: number;
}

export class GenerateCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the generate command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));
  }

  /**
   * Handle a generate command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      lowConfidenceConfirmed?: boolean;
      remainingSteps?: number;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, lang, handlerId = uniqueID() } = params;
    const t = getTranslation(lang);
    const MAX_STEP_COUNT = 3;
    const remainingSteps =
      typeof options.remainingSteps !== 'undefined' ? options.remainingSteps : MAX_STEP_COUNT;

    if (remainingSteps <= 0) {
      return {
        status: CommandResultStatus.SUCCESS,
      };
    }

    if (typeof params.command.systemPrompts === 'undefined') {
      params.command.systemPrompts = [];
    }
    const systemPrompts = params.command.systemPrompts;

    const originalQuery = this.commandProcessor.getPendingCommand(title)?.payload.originalQuery;

    // Replace the placeholder with the {{stw-selected...}} in the original query.
    command.query = this.restoreStwSelectedBlocks({ originalQuery, query: command.query });

    const hasStwSelected = new RegExp(STW_SELECTED_PATTERN).test(command.query);

    if (hasStwSelected) {
      systemPrompts.push(`The user query included one or more selections in the format {{stw-selected from:<startLine>,to:<endLine>,selection:<selectionContent>,path:<notePath>}}.
Use the <selectionContent> value from the selection(s) as the primary context for your response.
The response should be in natural language and not include the selection(s) {{stw-selected...}}`);
    }

    // Get recently created note information (for context)
    const createdNotesArtifact = await this.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactByType(ArtifactType.CREATED_NOTES);
    // Get recently created note information
    if (createdNotesArtifact && createdNotesArtifact.artifactType === ArtifactType.CREATED_NOTES) {
      // We have a recently created note (available for future use)
    }

    const conversationHistory = await this.renderer.extractConversationHistory(title, {
      summaryPosition: 1,
    });

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    const userMessage = await prepareMessage(command.query, this.plugin);

    const { editTool } = createEditTool({
      contentType: 'in_the_note',
    });

    const modifier = new SystemPromptModifier(systemPrompts);
    const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

    // Collect the error from the stream to handle it with our handle function.
    let streamError: Error | null = null;

    const { textStream, toolCalls: toolCallsPromise } = streamText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('generate'),
      system:
        modifier.apply(`You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content in Markdown.

You have access to the following tools:

- ${EDIT_TOOL_NAME} - Update existing content in a note.
- ${REQUEST_READ_CONTENT_TOOL_NAME} - Read content from notes to gather context before generating a response.
- ${ASK_USER_TOOL_NAME} - Ask the user for additional information or clarification when needed.

GUIDELINES:
- Use the ${REQUEST_READ_CONTENT_TOOL_NAME} tool if you need more context before generating a response.
- Use the ${EDIT_TOOL_NAME} tool if you need to update existing content.
- Use ${ASK_USER_TOOL_NAME} when you need clarification or additional information from the user to fulfill their request.
- When updating content, return ONLY the specific changed content, not the entire surrounding context.
- For all other content generation requests, generate detailed and well-structured content in Markdown.
${languageEnforcementFragment}`),
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ],
      tools: {
        [REQUEST_READ_CONTENT_TOOL_NAME]: requestReadContentTool,
        [EDIT_TOOL_NAME]: editTool,
        [ASK_USER_TOOL_NAME]: askUserTool,
      },
      onError: ({ error }) => {
        streamError = error instanceof Error ? error : new Error(String(error));
      },
    });

    const streamErrorPromise = waitForError(() => streamError);

    // First, we render the text-delta as a stream
    const messageId = (await Promise.race([
      this.renderer.streamConversationNote({
        path: title,
        stream: textStream,
        command: 'generate',
        handlerId,
        // lang,
      }),
      streamErrorPromise,
    ])) as Awaited<string | undefined>;

    if (messageId) {
      await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        text: `*${t('common.artifactCreated', { type: ArtifactType.GENERATED_CONTENT })}*`,
        artifact: {
          artifactType: ArtifactType.GENERATED_CONTENT,
          messageId,
          content: (await this.renderer.getMessageById(title, messageId))?.content || '',
        },
      });
    }

    const toolInvocations: ToolInvocation<string>[] = [];

    // Then, we handle tool calls
    const toolCalls = (await Promise.race([toolCallsPromise, streamErrorPromise])) as Awaited<
      typeof toolCallsPromise
    >;

    for (const toolCall of toolCalls) {
      switch (toolCall.toolName) {
        case REQUEST_READ_CONTENT_TOOL_NAME: {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.explanation,
            command: 'generate',
            includeHistory: false,
            lang,
            handlerId,
          });

          // Initialize ReadCommandHandler and process the reading request
          const readCommandHandler = new ReadCommandHandler(this.plugin);

          const readResult = await readCommandHandler.handle({
            title,
            command: {
              commandType: 'read',
              query: toolCall.args.query,
              model: command.model,
            },
            nextCommand: command,
            lang,
            handlerId: `fromGenerate_${handlerId}`,
          });

          // Record read command execution if tracking is active (check frontmatter)
          const tracking = await this.plugin.commandTrackingService.getTracking(title);
          if (tracking) {
            await this.plugin.commandTrackingService.recordCommandExecution(title, 'read');
          }

          if (readResult.status === CommandResultStatus.SUCCESS) {
            // Call handle again after reading
            return this.handle(params, {
              remainingSteps: remainingSteps - 1,
            });
          } else if (readResult.status === CommandResultStatus.NEEDS_CONFIRMATION) {
            return {
              ...readResult,
              onFinal: async () => {
                await this.handle(params, {
                  remainingSteps: remainingSteps - 1,
                });
              },
            };
          } else {
            return readResult;
          }
        }

        case EDIT_TOOL_NAME: {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.explanation,
            command: 'generate',
            includeHistory: false,
            role: 'Steward',
            lang,
            handlerId,
          });

          await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

          if (toolCall.args.operations.length === 0) {
            break;
          }

          for (const operation of toolCall.args.operations) {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: this.plugin.noteContentService.formatCallout(
                operation.newContent,
                'stw-search-result',
                {
                  mdContent: new MarkdownUtil(operation.newContent)
                    .escape(true)
                    .encodeForDataset()
                    .getText(),
                }
              ),
              command: 'generate',
              includeHistory: false,
              lang,
              handlerId,
            });
          }

          // Store artifact
          const artifactId = await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
            text: `*${t('common.artifactCreated', { type: ArtifactType.CONTENT_UPDATE })}*`,
            artifact: {
              artifactType: ArtifactType.CONTENT_UPDATE,
              updateExtraction: toolCall.args,
              path: toolCall.args.filePath || this.app.workspace.getActiveFile()?.path || '',
            },
          });

          toolInvocations.push({
            ...toolCall,
            result: `artifactRef:${artifactId}`,
          });

          // If there's no next command, automatically trigger update_from_artifact
          if (!nextCommand) {
            await this.renderer.serializeToolInvocation({
              path: title,
              command: 'generate',
              toolInvocations,
              handlerId,
            });

            const updateCommandHandler = new UpdateCommandHandler(this.plugin);
            return updateCommandHandler.handle({
              title,
              lang,
              handlerId: `fromGenerate_${handlerId}`,
              command: {
                commandType: 'update',
                query: 'Apply the content updates from the generated artifact',
              },
            });
          }
          break;
        }

        case ASK_USER_TOOL_NAME: {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.message,
            command: 'generate',
            includeHistory: false,
            lang,
          });

          return {
            status: CommandResultStatus.NEEDS_USER_INPUT,
            onUserInput: async message => {
              toolInvocations.push({
                ...toolCall,
                result: message,
              });

              await this.renderer.serializeToolInvocation({
                path: title,
                command: 'generate',
                toolInvocations,
                handlerId,
              });

              return this.handle(params, {
                remainingSteps: remainingSteps - 1,
              });
            },
          };
        }

        default:
          break;
      }
    }

    if (toolInvocations.length > 0) {
      await this.renderer.serializeToolInvocation({
        path: title,
        command: 'generate',
        toolInvocations,
        handlerId,
      });
    }

    // If no text or tool calls, return error
    if (!messageId && toolCalls.length === 0) {
      // No tool calls and no text, return error
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('generate.noResponse')}*`,
        command: 'generate',
        handlerId,
        lang,
      });
      return {
        status: CommandResultStatus.ERROR,
        error: new Error('No response was generated by the AI'),
      };
    }

    return {
      status: CommandResultStatus.SUCCESS,
    };
  }
}
