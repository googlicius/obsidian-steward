import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { streamText, generateText, tool } from 'ai';
import { prepareMessage } from 'src/lib/modelfusion';
import { CommandIntent, ConversationHistoryMessage } from 'src/types/types';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { STW_SELECTED_PATTERN } from 'src/constants';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { ReadCommandHandler } from '../ReadCommandHandler/ReadCommandHandler';
import { languageEnforcementFragment } from 'src/lib/modelfusion/prompts/fragments';
import { generateContentSchema } from './zSchemas';
import { GENERATE_COMMAND_TOOLS } from './toolNames';
import {
  requestReadContentTool,
  REQUEST_READ_CONTENT_TOOL_NAME,
} from '../../tools/requestReadContent';
import { createEditTool, EDIT_TOOL_NAME } from '../../tools/editContent';
import { ToolInvocation } from '../../tools/types';
import { UpdateCommandHandler } from '../UpdateCommandHandler/UpdateCommandHandler';
import { uniqueID } from 'src/utils/uniqueID';
import { SystemPromptModifier } from '../../SystemPromptModifier';

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
    const { title, command, nextCommand, lang, prevCommand, handlerId = uniqueID() } = params;
    const t = getTranslation(lang);
    const MAX_STEP_COUNT = 3;
    const remainingSteps =
      typeof options.remainingSteps !== 'undefined' ? options.remainingSteps : MAX_STEP_COUNT;

    if (remainingSteps <= 0) {
      return {
        status: CommandResultStatus.SUCCESS,
      };
    }

    const fromRead = prevCommand && prevCommand.commandType === 'read';

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

    const isUpdate = nextCommand && nextCommand.commandType === 'update_from_artifact';

    const conversationHistory = await this.renderer.extractConversationHistory(title, {
      summaryPosition: 1,
    });

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    // Only use prepareMessage for update commands
    const userMessage = isUpdate ? await prepareMessage(command.query, this.plugin) : command.query;

    const { editTool } = createEditTool({
      contentType: 'in_the_note',
    });

    const modifier = new SystemPromptModifier(systemPrompts);
    const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

    const extraction = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('generate'),
      system:
        modifier.apply(`You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content in Markdown.

You have access to the following tools:

- ${EDIT_TOOL_NAME} - Update existing content in a note.
- ${GENERATE_COMMAND_TOOLS.GENERATE_CONTENT} - Generate new content for a note.
- ${REQUEST_READ_CONTENT_TOOL_NAME} - Read content from notes to gather context before generating a response.

GUIDELINES:
- If you need more context before generating a response, use the ${REQUEST_READ_CONTENT_TOOL_NAME} tool first.
- If the user wants to update existing content, use the ${EDIT_TOOL_NAME} tool.
- For all other content generation requests, use the ${GENERATE_COMMAND_TOOLS.GENERATE_CONTENT} tool.
- When updating content, return ONLY the specific changed content, not the entire surrounding context.
- IMPORTANT: Even if you cannot see images referenced in the user's request, you can still proceed with content generation. The actual generation process can access and process images when needed, so don't hesitate to generate content based on image-related requests.
${languageEnforcementFragment}`),
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ],
      tools: {
        [GENERATE_COMMAND_TOOLS.GENERATE_CONTENT]: tool({
          parameters: generateContentSchema,
        }),
        [REQUEST_READ_CONTENT_TOOL_NAME]: requestReadContentTool,
        [EDIT_TOOL_NAME]: editTool,
      },
    });

    // If no tool calls were made but we have text, render the text
    if (extraction.toolCalls.length === 0) {
      if (extraction.text && extraction.text.trim()) {
        const messageId = await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.text,
          command: 'generate',
          handlerId,
          lang,
        });

        if (messageId) {
          // Store the text as generated_content artifact
          await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
            text: `*${t('common.artifactCreated', { type: ArtifactType.GENERATED_CONTENT })}*`,
            artifact: {
              artifactType: ArtifactType.GENERATED_CONTENT,
              content: extraction.text,
              messageId,
            },
          });
        }

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No tool calls were made but we have text'),
        };
      } else {
        // No tool calls and no text, return error
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error: No response was generated by the AI*`,
          command: 'generate',
          handlerId,
          lang,
        });
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No response was generated by the AI'),
        };
      }
    }

    const toolInvocations: ToolInvocation<string>[] = [];

    for (const toolCall of extraction.toolCalls) {
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

          await this.renderer.serializeToolInvocation({
            path: title,
            command: 'generate',
            toolInvocations,
          });

          // If there's no next command, automatically trigger update_from_artifact
          if (!nextCommand) {
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

        case GENERATE_COMMAND_TOOLS.GENERATE_CONTENT: {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.explanation,
            includeHistory: false,
            role: 'Steward',
            lang,
          });

          await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

          const conversationHistory = await this.renderer.extractConversationHistory(title, {
            summaryPosition: 1,
          });

          const file = toolCall.args.noteName
            ? await this.plugin.mediaTools.findFileByNameOrPath(toolCall.args.noteName)
            : null;

          const noteContent = file ? await this.app.vault.cachedRead(file) : '';

          const stream = await this.contentGenerationStream({
            command: {
              ...command,
              systemPrompts,
            },
            conversationHistory: conversationHistory,
            errorCallback: async error => {
              logger.error('Error in contentGenerationStream', error);

              let errorMessage =
                '*An error occurred while generating content, please check the console log (Ctrl+Shift+I)*';

              if (typeof error === 'object' && error !== null && 'toString' in error) {
                errorMessage = `*Error: ${error.toString()}*`;
              }

              await this.renderer.updateConversationNote({
                path: title,
                newContent: errorMessage,
              });
            },
          });

          if (
            fromRead ||
            !toolCall.args.noteName ||
            !toolCall.args.modifiesNote ||
            !file ||
            noteContent.trim() !== ''
          ) {
            const messageId = await this.renderer.streamConversationNote({
              path: title,
              stream,
              command: 'generate',
              includeHistory: false,
            });

            if (!messageId) {
              throw new Error('Failed to stream conversation note');
            }

            await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
              text: `*${t('common.artifactCreated', { type: ArtifactType.GENERATED_CONTENT })}*`,
              artifact: {
                artifactType: ArtifactType.GENERATED_CONTENT,
                messageId,
                content: (await this.renderer.getMessageById(title, messageId))?.content || '',
              },
            });

            toolInvocations.push({
              ...toolCall,
              result: 'messageRef:' + messageId,
            });

            await this.renderer.serializeToolInvocation({
              path: title,
              command: 'generate',
              toolInvocations,
            });
          }
          break;
        }

        default:
          break;
      }
    }

    return {
      status: CommandResultStatus.SUCCESS,
    };
  }

  private async contentGenerationStream(args: {
    command: CommandIntent;
    conversationHistory?: ConversationHistoryMessage[];
    errorCallback?: (error: unknown) => Promise<void>;
  }): Promise<AsyncIterable<string>> {
    const { command, conversationHistory = [], errorCallback } = args;
    const { query, systemPrompts = [], model } = command;
    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: model,
      generateType: 'text',
    });

    const modifier = new SystemPromptModifier(systemPrompts);
    const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

    const { textStream } = streamText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('generate'),
      system:
        modifier.apply(`You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content. Format the content in Markdown.
The content should not include the big heading on the top.
${languageEnforcementFragment}`),
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory,
        {
          role: 'user',
          content: await prepareMessage(query, this.plugin),
        },
      ],
      onError: async ({ error }) => {
        try {
          if (errorCallback) {
            await errorCallback(error);
          }
        } catch (callbackError) {
          logger.error('Error in error callback:', callbackError);
        }
      },
    });

    return textStream;
  }
}
