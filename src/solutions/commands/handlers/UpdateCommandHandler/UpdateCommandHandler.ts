import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import {
  ArtifactType,
  ContentUpdateArtifact,
  GeneratedContentArtifact,
} from 'src/solutions/artifact';
import { extractUpdateFromSearchResult, UpdateInstruction } from 'src/lib/modelfusion/extractions';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { CommandIntent, DocWithPath } from 'src/types/types';
import { generateId, generateText, Message } from 'ai';
import {
  REQUEST_READ_CONTENT_TOOL_NAME,
  requestReadContentTool,
} from '../../tools/requestReadContent';
import { GREP_TOOL_NAME, grepTool, execute as grepExecute } from '../../tools/grepContent';
import { EDIT_TOOL_NAME, editTool } from '../../tools/editContent';
import { ReadCommandHandler } from '../ReadCommandHandler/ReadCommandHandler';

const updatableTypes = [
  ArtifactType.SEARCH_RESULTS,
  ArtifactType.CREATED_NOTES,
  ArtifactType.CONTENT_UPDATE,
  ArtifactType.GENERATED_CONTENT,
];

export class UpdateCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the update command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.updating'));
  }

  /**
   * Update the generated content
   */
  private async handleUpdateGeneratedContent(params: {
    artifact: GeneratedContentArtifact;
    command: CommandIntent;
    title: string;
    lang?: string | null;
    /**
     * Messages in this command
     */
    messages: Message[];
    /**
     * Remaining steps for the LLM to execute
     */
    remainingSteps?: number;
  }): Promise<CommandResult> {
    const t = getTranslation(params.lang);
    const MAX_STEP_COUNT = 10;
    const remainingSteps =
      typeof params.remainingSteps !== 'undefined' ? params.remainingSteps : MAX_STEP_COUNT;

    if (remainingSteps <= 0) {
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: `*Error: I have reached the maximum number of steps.*`,
        lang: params.lang,
      });
      return {
        status: CommandResultStatus.ERROR,
        error: new Error('The update command has reached the maximum number of steps'),
      };
    }

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: params.command.model,
      generateType: 'text',
    });

    const extraction = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('update'),
      system: `You are a helpful assistant that updates generated content in a Obsidian note.
Update the content in the note based on the instructions provided.

You have access to the following tools:

1. ${REQUEST_READ_CONTENT_TOOL_NAME} - Read content from a note.
2. ${GREP_TOOL_NAME} - Search for specific text patterns in notes.
3. ${EDIT_TOOL_NAME} - Update content by replacing old content with new content.

GUIDELINES:
- use the ${REQUEST_READ_CONTENT_TOOL_NAME} to read the content above/below the current cursor or the entire note.
- Use ${GREP_TOOL_NAME} to find specific text patterns that need to be updated.
- Use ${EDIT_TOOL_NAME} to make the actual content changes.
- You MUST use tools to fulfill the query.
`,
      messages: params.messages,
      tools: {
        [REQUEST_READ_CONTENT_TOOL_NAME]: requestReadContentTool,
        [GREP_TOOL_NAME]: grepTool,
        [EDIT_TOOL_NAME]: editTool,
      },
    });

    const toolResults = [];

    for (const toolCall of extraction.toolCalls) {
      switch (toolCall.toolName) {
        case REQUEST_READ_CONTENT_TOOL_NAME: {
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: toolCall.args.explanation,
            command: 'update',
            includeHistory: false,
            lang: params.lang,
          });

          // Initialize ReadCommandHandler and process the reading request
          const readCommandHandler = new ReadCommandHandler(this.plugin);

          const readResult = await readCommandHandler.handle({
            title: params.title,
            command: {
              commandType: 'read',
              query: toolCall.args.query,
              model: params.command.model,
            },
            nextCommand: params.command,
            lang: params.lang,
          });

          if (readResult.status === CommandResultStatus.SUCCESS) {
            // Call handleUpdateGeneratedContent again after reading
            return this.handleUpdateGeneratedContent({
              ...params,
              remainingSteps: remainingSteps - 1,
            });
          } else {
            return readResult;
          }
        }

        case GREP_TOOL_NAME: {
          // Handle grep content search
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: toolCall.args.explanation,
            command: 'update',
            includeHistory: false,
            lang: params.lang,
          });

          try {
            const grepResult = await grepExecute(toolCall.args, this.plugin);

            toolResults.push({
              ...toolCall,
              result: grepResult,
            });
          } catch (error) {
            const errorResult = `*Error searching content: ${error.message}*`;
            await this.renderer.updateConversationNote({
              path: params.title,
              newContent: errorResult,
              includeHistory: false,
            });
            toolResults.push({
              ...toolCall,
              result: errorResult,
            });
          }
          break;
        }

        case EDIT_TOOL_NAME: {
          // Handle edit content
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: toolCall.args.explanation,
            command: 'update',
            includeHistory: false,
            lang: params.lang,
          });

          const file = toolCall.args.filePath
            ? await this.plugin.mediaTools.findFileByNameOrPath(toolCall.args.filePath)
            : this.plugin.app.workspace.getActiveFile();

          if (!file) {
            throw new Error('No file provided');
          }

          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: t('update.applyChangesConfirm'),
          });

          return {
            status: CommandResultStatus.NEEDS_CONFIRMATION,
            onConfirmation: async () => {
              return this.performUpdate({
                title: params.title,
                docs: [
                  {
                    path: file.path,
                  },
                ],
                updateInstructions: [
                  {
                    type: 'replace',
                    fromLine: toolCall.args.fromLine,
                    toLine: toolCall.args.toLine,
                    new: toolCall.args.newContent,
                  },
                ],
                lang: params.lang,
              });
            },
            onRejection: () => {
              return {
                status: CommandResultStatus.SUCCESS,
              };
            },
          };
        }

        default:
          break;
      }
    }

    // If there are tool calls, continue with the process
    if (extraction.toolCalls.length > 0) {
      // Calculate remaining steps
      const newRemainingSteps = remainingSteps > 0 ? remainingSteps - 1 : 0;

      // Continue handling if there are steps remaining
      if (newRemainingSteps > 0) {
        await this.renderIndicator(params.title, params.lang || undefined);

        // Keep track of the assistant's requests and the user's responses for tool calls
        const updatedMessages = [
          ...params.messages,
          {
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
          } as Message,
        ];

        return this.handleUpdateGeneratedContent({
          ...params,
          remainingSteps: newRemainingSteps,
          messages: updatedMessages,
        });
      }
    }

    return {
      status: CommandResultStatus.SUCCESS,
    };
  }

  /**
   * Handle update the content_update artifact
   */
  private async handleUpdateContentUpdate(
    params: CommandHandlerParams,
    artifact: ContentUpdateArtifact,
    docs: DocWithPath[]
  ): Promise<CommandResult> {
    const t = getTranslation(params.lang);

    // Convert the updates in the extraction to UpdateInstruction objects
    const updateInstructions = artifact.updateExtraction.updates.map(update => ({
      type: 'replace' as const,
      fromLine: update.fromLine,
      toLine: update.toLine,
      new: update.updatedContent,
    }));

    if (updateInstructions.length === 0) {
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: t('update.noChangesNeeded'),
        lang: params.lang,
      });
      return {
        status: CommandResultStatus.SUCCESS,
      };
    }

    await this.renderer.updateConversationNote({
      path: params.title,
      newContent: t('update.applyChangesConfirm'),
    });

    return {
      status: CommandResultStatus.NEEDS_CONFIRMATION,
      onConfirmation: () => {
        return this.performUpdate({
          title: params.title,
          docs,
          updateInstructions,
          lang: params.lang,
        });
      },
      onRejection: () => {
        return {
          status: CommandResultStatus.SUCCESS,
        };
      },
    };
  }

  /**
   * Handle an update command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command, lang } = params;
    const t = getTranslation(lang);

    // Retrieve the most recent artifact of updatable types
    const artifact = await this.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes(updatableTypes);

    if (!artifact) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('common.noRecentOperations')}*`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error: new Error('No recent operations found'),
      };
    }

    // Extract docs from another artifact
    let docs: DocWithPath[] = [];

    if (artifact.artifactType === ArtifactType.SEARCH_RESULTS) {
      docs = artifact.originalResults.map(result => ({ path: result.document.path }));
    } else if (artifact.artifactType === ArtifactType.CREATED_NOTES) {
      docs = artifact.paths.map(path => ({ path }));
    } else if (artifact.artifactType === ArtifactType.CONTENT_UPDATE) {
      docs = [{ path: artifact.path }];
    }

    if (docs.length === 0 && artifact.artifactType !== ArtifactType.GENERATED_CONTENT) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('common.noFilesFound'),
      });

      return {
        status: CommandResultStatus.ERROR,
        error: new Error('No files found'),
      };
    }

    // If we have a content update artifact, we can use it directly
    if (artifact.artifactType === ArtifactType.CONTENT_UPDATE) {
      return this.handleUpdateContentUpdate(params, artifact, docs);
    }

    const conversationHistory = await this.renderer.extractConversationHistory(title, {
      summaryPosition: 1,
    });

    if (artifact.artifactType === ArtifactType.GENERATED_CONTENT) {
      return this.handleUpdateGeneratedContent({
        ...params,
        artifact,
        messages: [
          ...conversationHistory,
          { role: 'user', content: params.command.query, id: generateId() },
        ],
      });
    }

    // For other artifact types, extract the update instructions
    const extraction = await extractUpdateFromSearchResult({
      userInput: command.query,
      systemPrompts: command.systemPrompts,
      conversationHistory,
      model: command.model,
    });

    await this.renderer.updateConversationNote({
      path: title,
      newContent: `*${extraction.explanation}*`,
      includeHistory: false,
    });

    if (extraction.confidence <= 0.7) {
      return {
        status: CommandResultStatus.ERROR,
        error: new Error('Low confidence in update extraction'),
      };
    }

    // Perform the updates
    return this.performUpdate({
      title,
      docs,
      updateInstructions: extraction.updateInstructions,
      lang: extraction.lang,
    });
  }

  /**
   * Perform the actual update operation
   */
  private async performUpdate(params: {
    title: string;
    docs: DocWithPath[];
    updateInstructions: UpdateInstruction[];
    lang?: string | null;
  }): Promise<CommandResult> {
    const { title, docs, updateInstructions, lang } = params;
    const t = getTranslation(lang);

    try {
      // Perform the updates
      const updatedFiles: string[] = [];
      const failedFiles: string[] = [];
      const skippedFiles: string[] = [];

      for (const doc of docs) {
        try {
          const file = await this.plugin.mediaTools.findFileByNameOrPath(doc.path);
          if (file) {
            // Read the file content
            let content = await this.app.vault.read(file);

            let contentChanged = false;

            // Apply each update instruction in sequence
            for (const instruction of updateInstructions) {
              const updatedContent = await this.obsidianAPITools.applyUpdateInstruction(
                content,
                instruction
              );

              if (updatedContent !== content) {
                content = updatedContent;
                contentChanged = true;
              }
            }

            if (!contentChanged) {
              logger.log(`Skipping ${doc.path} because it didn't change`);
              skippedFiles.push(doc.path);
              continue;
            }

            // Write the updated content back
            await this.app.vault.process(file, () => content);
            updatedFiles.push(doc.path);
          }
        } catch (error) {
          failedFiles.push(doc.path);
        }
      }

      // Format the results
      let response = t('update.foundFiles', { count: docs.length });

      if (updatedFiles.length > 0) {
        response += `\n\n**${t('update.successfullyUpdated', { count: updatedFiles.length })}**`;
        updatedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (skippedFiles.length > 0) {
        response += `\n\n**${t('update.skipped', { count: skippedFiles.length })}**`;
        skippedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      if (failedFiles.length > 0) {
        response += `\n\n**${t('update.failed', { count: failedFiles.length })}**`;
        failedFiles.forEach(file => {
          response += `\n- [[${file}]]`;
        });
      }

      // Update the conversation with the results
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response,
        command: 'update',
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error updating files: ${error.message}`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
