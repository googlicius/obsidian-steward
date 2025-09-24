import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { streamText, generateText, tool } from 'ai';
import { prepareMessage } from 'src/lib/modelfusion';
import { MediaTools } from 'src/tools/mediaTools';
import { CommandIntent, ConversationHistoryMessage } from 'src/types/types';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { STW_SELECTED_PATTERN, STW_SELECTED_PLACEHOLDER } from 'src/constants';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { type CommandProcessor } from '../../CommandProcessor';
import { ReadCommandHandler } from '../ReadCommandHandler/ReadCommandHandler';
import { languageEnforcementFragment } from 'src/lib/modelfusion/prompts/fragments';
import { updateContentSchema, generateContentSchema, contentReadingSchema } from './zSchemas';

export interface ContentUpdate {
  updatedContent: string;
  originalContent: string;
}

export class GenerateCommandHandler extends CommandHandler {
  constructor(
    public readonly plugin: StewardPlugin,
    private readonly commandProcessor: CommandProcessor
  ) {
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
    const { title, command, nextCommand, lang, prevCommand } = params;
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
    if (
      originalQuery &&
      originalQuery.includes('{{stw-selected') &&
      command.query.includes(STW_SELECTED_PLACEHOLDER)
    ) {
      const stwSelectedBlocks = Array.from(
        originalQuery.matchAll(new RegExp(STW_SELECTED_PATTERN, 'g'))
      );
      if (stwSelectedBlocks.length > 0) {
        // Replace all instances of <stwSelected> with the actual stw-selected blocks
        for (const match of stwSelectedBlocks) {
          command.query = command.query.replace(STW_SELECTED_PLACEHOLDER, match[0]);
        }
      }
    }

    const hasStwSelected = new RegExp(STW_SELECTED_PATTERN).test(command.query);

    if (hasStwSelected) {
      systemPrompts.push(`The user query included one or more selections in the format {{stw-selected from:<startLine>,to:<endLine>,selection:<selectionContent>,path:<notePath>}}.
Use the <selectionContent> value from the selection(s) as the primary context for your response.
The response should be in natural language and not include the selection(s) {{stw-selected...}}`);
    }

    let readArtifact;
    if (fromRead) {
      readArtifact = this.artifactManager.getMostRecentArtifactByType(
        title,
        ArtifactType.READ_CONTENT
      );

      if (!readArtifact) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*No read content found*`,
          lang,
        });
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No read content found'),
        };
      }

      const noteName = readArtifact.readingResult.file?.name || 'current';

      const artifactContent = `The read command's content from the ${noteName} note:\n${JSON.stringify(
        readArtifact.readingResult.blocks.map(block => block.content)
      )}`;

      // Inject the artifact content into the command query
      command.query = `${artifactContent}\n\n${command.query}`;
    }

    // Get recently created note information (for context)
    const createdNotesArtifact = this.artifactManager.getMostRecentArtifactByType(
      title,
      ArtifactType.CREATED_NOTES
    );
    // Get recently created note information
    if (createdNotesArtifact && createdNotesArtifact.type === ArtifactType.CREATED_NOTES) {
      // We have a recently created note (available for future use)
    }

    const isUpdate = nextCommand && nextCommand.commandType === 'update_from_artifact';

    const conversationHistory = await this.renderer.extractConversationHistory(title);

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    // Only use prepareMessage for update commands
    const userMessage = isUpdate ? await prepareMessage(command.query, this.app) : command.query;

    const extraction = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('generate'),
      system: `You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content in Markdown.

You have access to the following tools:

1. updateContent - Update existing content in a note.
2. generateContent - Generate new content for a note.
3. contentReading - Read content from notes to gather context before generating a response.

GUIDELINES:
- If you need more context before generating a response, use the contentReading tool first.
- If the user wants to update existing content, use the updateContent tool.
- For all other content generation requests, use the generateContent tool.
- You MUST use tools to fulfill the query.
- IMPORTANT: Even if you cannot see images referenced in the user's request, you can still proceed with content generation. The actual generation process can access and process images when needed, so don't hesitate to generate content based on image-related requests.
${
  isUpdate
    ? `IMPORTANT: This is an update request. Please do NOT use the generateContent tool.`
    : ``
}

${languageEnforcementFragment}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ],
      tools: {
        updateContent: tool({
          parameters: updateContentSchema,
        }),
        generateContent: tool({
          parameters: generateContentSchema,
        }),
        contentReading: tool({
          parameters: contentReadingSchema,
        }),
      },
      toolChoice: 'required',
    });

    // If no tool calls were made but we have text, render the text
    if (extraction.toolCalls.length === 0) {
      if (extraction.text && extraction.text.trim()) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.text,
          lang,
        });
        return {
          status: CommandResultStatus.SUCCESS,
        };
      } else {
        // No tool calls and no text, return error
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error: No response was generated by the AI*`,
          lang,
        });
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No response was generated by the AI'),
        };
      }
    }

    for (const toolCall of extraction.toolCalls) {
      switch (toolCall.toolName) {
        case 'contentReading': {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.explanation,
            command: 'read',
            includeHistory: false,
            lang,
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
          });

          if (readResult.status === CommandResultStatus.SUCCESS) {
            // Call handle again after reading
            return this.handle(params, {
              remainingSteps: remainingSteps - 1,
            });
          } else {
            return readResult;
          }
        }

        case 'updateContent': {
          try {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: toolCall.args.explanation,
              includeHistory: false,
              role: 'Steward',
              lang,
            });

            await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));

            if (toolCall.args.updates.length === 0) {
              return {
                status: CommandResultStatus.SUCCESS,
              };
            }

            // Store artifact
            const artifactId = `update-${Date.now()}`;
            this.artifactManager.storeArtifact(title, artifactId, {
              type: ArtifactType.CONTENT_UPDATE,
              updateExtraction: toolCall.args,
              path: toolCall.args.notePath || this.app.workspace.getActiveFile()?.path || '',
            });

            await this.renderer.updateConversationNote({
              path: title,
              newContent: `*${t('common.artifactCreated', {
                type: ArtifactType.CONTENT_UPDATE,
              })}*`,
              command: 'generate',
              lang,
            });

            for (const update of toolCall.args.updates) {
              await this.renderer.updateConversationNote({
                path: title,
                newContent: this.plugin.noteContentService.formatCallout(
                  update.updatedContent,
                  'stw-search-result',
                  {
                    mdContent: new MarkdownUtil(update.updatedContent)
                      .escape(true)
                      .encodeForDataset()
                      .getText(),
                  }
                ),
                lang,
              });
            }

            // If there's no next command, automatically trigger update_from_artifact
            if (!nextCommand) {
              await this.plugin.commandProcessorService.processCommands({
                title,
                commands: [
                  {
                    commandType: 'update_from_artifact',
                    query: 'Apply the content updates from the generated artifact',
                  },
                ],
                lang,
              });
            }

            return {
              status: CommandResultStatus.SUCCESS,
            };
          } catch (error) {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: `*Error generating: ${error.message}*`,
              lang,
            });

            return {
              status: CommandResultStatus.ERROR,
              error,
            };
          }
        }

        case 'generateContent': {
          try {
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

            const mediaTools = MediaTools.getInstance(this.app);

            const file = toolCall.args.noteName
              ? await mediaTools.findFileByNameOrPath(toolCall.args.noteName)
              : null;

            const noteContent = file ? await this.app.vault.read(file) : '';

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
              await this.renderer.streamConversationNote({
                path: title,
                stream,
                command: 'generate',
              });
            } else {
              const mainLeaf = await this.plugin.getMainLeaf();

              if (mainLeaf && file) {
                mainLeaf.openFile(file);
                await this.app.workspace.revealLeaf(mainLeaf);
              }

              let accumulatedContent = '';
              for await (const chunk of stream) {
                accumulatedContent += chunk;
              }

              await this.app.vault.process(file, () => accumulatedContent);

              await this.renderer.updateConversationNote({
                path: title,
                newContent: `*${t('generate.success', { noteName: toolCall.args.noteName })}*`,
                lang,
              });

              this.artifactManager.deleteArtifact(title, ArtifactType.CREATED_NOTES);
            }

            return {
              status: CommandResultStatus.SUCCESS,
            };
          } catch (error) {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: `*Error generating: ${error.message}*`,
              lang,
            });

            return {
              status: CommandResultStatus.ERROR,
              error,
            };
          }
        }

        default:
          break;
      }
    }

    // If we get here, no valid tool call was found
    await this.renderer.updateConversationNote({
      path: title,
      newContent: `*Error: No valid tool was selected*`,
      lang,
    });

    return {
      status: CommandResultStatus.ERROR,
      error: new Error('No valid tool was selected'),
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

    const { textStream } = streamText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('generate'),
      system: `You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content. Format the content in Markdown.
The content should not include the big heading on the top.
${languageEnforcementFragment}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory,
        {
          role: 'user',
          content: await prepareMessage(query, this.app),
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
