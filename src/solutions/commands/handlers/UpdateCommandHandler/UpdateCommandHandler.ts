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
  ReadContentArtifact,
} from 'src/solutions/artifact';
import { extractUpdateFromSearchResult, UpdateInstruction } from 'src/lib/modelfusion/extractions';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { CommandIntent, DocWithPath } from 'src/types/types';
import { generateId, generateText, Message } from 'ai';
import { requestReadContentTool } from '../../tools/requestReadContent';
import { grepTool, execute as grepExecute } from '../../tools/grepContent';
import { createEditTool } from '../../tools/editContent';
import { ReadCommandHandler } from '../ReadCommandHandler/ReadCommandHandler';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { STW_SELECTED_PATTERN, STW_SELECTED_PLACEHOLDER } from 'src/constants';
import { uniqueID } from 'src/utils/uniqueID';
import { SystemPromptModifier } from '../../SystemPromptModifier';
import { ToolRegistry, ToolName } from '../../ToolRegistry';

const updatableTypes = [
  ArtifactType.SEARCH_RESULTS,
  ArtifactType.CREATED_NOTES,
  ArtifactType.CONTENT_UPDATE,
  ArtifactType.GENERATED_CONTENT,
  ArtifactType.READ_CONTENT,
];

export class UpdateCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the update command
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.updating'));
  }

  /**
   * Handle update directly if the stw-selected block is included in the query
   */
  private async handleUpdateStwSelected(params: {
    title: string;
    command: CommandIntent;
    messages: Message[];
    lang?: string | null;
    handlerId: string;
  }): Promise<CommandResult> {
    const t = getTranslation(params.lang);
    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: params.command.model,
      generateType: 'text',
    });

    const { editTool, execute: editToolExecute } = createEditTool({
      contentType: 'in_the_note',
    });

    const modifier = new SystemPromptModifier(params.command.systemPrompts);

    const tools = { [ToolName.EDIT]: editTool };
    const registry = ToolRegistry.buildFromTools(tools, params.command.tools);

    const extraction = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('update'),
      system: modifier.apply(`You are a helpful assistant that updates content in a Obsidian note.
Update the content in the note based on the instructions provided.

You have access to the following tools:

${registry.generateToolsSection()}

GUIDELINES:
${registry.generateGuidelinesSection()}
`),
      messages: params.messages,
      tools: registry.getToolsObject(),
    });

    // Render the text
    if (extraction.text && extraction.text.trim()) {
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: extraction.text,
        command: 'update',
        lang: params.lang,
      });
    }

    for (const toolCall of extraction.toolCalls) {
      switch (toolCall.toolName) {
        case ToolName.EDIT: {
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

          // Render what will be updated
          for (const operation of toolCall.args.operations) {
            await this.renderer.updateConversationNote({
              path: params.title,
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
              lang: params.lang,
            });
          }

          const updateInstructions = editToolExecute(toolCall.args);

          // Skip confirmation if no_confirm is true
          if (params.command.no_confirm) {
            return this.performUpdate({
              title: params.title,
              docs: [
                {
                  path: file.path,
                },
              ],
              updateInstructions,
              lang: params.lang,
              handlerId: params.handlerId,
            });
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
                docs: [
                  {
                    path: file.path,
                  },
                ],
                updateInstructions,
                lang: params.lang,
                handlerId: params.handlerId,
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

    return {
      status: CommandResultStatus.SUCCESS,
    };
  }

  /**
   * Update the generated or read content
   */
  private async handleUpdateGeneratedOrReadContent(params: {
    artifact: GeneratedContentArtifact | ReadContentArtifact;
    command: CommandIntent;
    title: string;
    lang?: string | null;
    /**
     * Remaining steps for the LLM to execute
     */
    remainingSteps?: number;
    handlerId: string;
  }): Promise<CommandResult> {
    const t = getTranslation(params.lang);
    const MAX_STEP_COUNT = 10;
    const { remainingSteps = MAX_STEP_COUNT, handlerId } = params;
    const isInitialCall = remainingSteps === MAX_STEP_COUNT;

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

    const conversationHistory = await this.renderer.extractConversationHistory(params.title, {
      summaryPosition: 1,
    });

    // Use provided messages or default to conversation history
    const messages: Message[] = isInitialCall
      ? [...conversationHistory, { role: 'user', content: params.command.query, id: generateId() }]
      : conversationHistory;

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: params.command.model,
      generateType: 'text',
    });

    const { editTool, execute: editToolExecute } = createEditTool({
      contentType:
        params.artifact.artifactType === ArtifactType.GENERATED_CONTENT
          ? // Generated content is still in the chat
            'in_the_chat'
          : // Read content is in the note
            'in_the_note',
    });

    const tools = {
      [ToolName.REQUEST_READ_CONTENT]: requestReadContentTool,
      [ToolName.GREP]: grepTool,
      [ToolName.EDIT]: editTool,
    };
    const registry = ToolRegistry.buildFromTools(tools, params.command.tools);

    const extraction = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('update'),
      system: `You are a helpful assistant that updates content in a Obsidian note.
Update the content in the note based on the instructions provided.

You have access to the following tools:

${registry.generateToolsSection()}

GUIDELINES:
${registry.generateGuidelinesSection()}
`,
      messages,
      tools: registry.getToolsObject(),
    });

    // Render the text
    if (extraction.toolCalls.length === 0 && extraction.text && extraction.text.trim()) {
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: extraction.text,
        command: 'update',
        lang: params.lang,
        handlerId,
      });
    }

    const toolResults = [];

    for (const toolCall of extraction.toolCalls) {
      switch (toolCall.toolName) {
        case ToolName.REQUEST_READ_CONTENT: {
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: toolCall.args.explanation,
            command: 'update',
            includeHistory: false,
            lang: params.lang,
            handlerId,
          });

          await this.renderer.addGeneratingIndicator(
            params.title,
            t('conversation.readingContent')
          );

          // Initialize ReadCommandHandler and process the reading request
          const readCommandHandler = new ReadCommandHandler(this.plugin);

          const readResult = await readCommandHandler.handle({
            title: params.title,
            command: {
              commandType: 'read',
              query: toolCall.args.query,
              model: params.command.model,
              no_confirm: params.command.no_confirm,
            },
            handlerId: `fromUpdate_${handlerId}`,
            lang: params.lang,
          });

          // Record read command execution if tracking is active (check frontmatter)
          const tracking = await this.plugin.commandTrackingService.getTracking(params.title);
          if (tracking) {
            await this.plugin.commandTrackingService.recordCommandExecution(params.title, 'read');
          }

          if (readResult.status === CommandResultStatus.SUCCESS) {
            // Call handleUpdateGeneratedContent again after reading
            return this.handleUpdateGeneratedOrReadContent({
              ...params,
              remainingSteps: remainingSteps - 1,
            });
          } else if (readResult.status === CommandResultStatus.NEEDS_CONFIRMATION) {
            return {
              ...readResult,
              onFinal: async () => {
                await this.renderIndicator(params.title, params.lang);

                await this.handleUpdateGeneratedOrReadContent({
                  ...params,
                  remainingSteps: remainingSteps - 1,
                });
              },
            };
          } else if (readResult.status === CommandResultStatus.NEEDS_USER_INPUT) {
            return readResult;
          } else {
            return readResult;
          }
        }

        case ToolName.GREP: {
          // Handle grep content search
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: toolCall.args.explanation,
            command: 'update',
            includeHistory: false,
            lang: params.lang,
            handlerId,
          });

          await this.renderer.addGeneratingIndicator(
            params.title,
            t('conversation.readingContent')
          );

          try {
            const grepResult = await grepExecute(toolCall.args, this.plugin);

            toolResults.push({
              ...toolCall,
              result: grepResult,
            });
          } catch (error) {
            const errorResult = `*${error.message}*`;
            await this.renderer.updateConversationNote({
              path: params.title,
              newContent: errorResult,
              includeHistory: false,
              handlerId,
            });
            toolResults.push({
              ...toolCall,
              result: errorResult,
            });
          }
          break;
        }

        case ToolName.EDIT: {
          // Handle edit content
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: toolCall.args.explanation,
            command: 'update',
            includeHistory: false,
            lang: params.lang,
            handlerId,
          });

          const file = toolCall.args.filePath
            ? await this.plugin.mediaTools.findFileByNameOrPath(toolCall.args.filePath)
            : this.plugin.app.workspace.getActiveFile();

          if (!file) {
            throw new Error('No file provided');
          }

          // Render what will be updated if the artifact type is read_content
          if (params.artifact.artifactType === ArtifactType.READ_CONTENT) {
            for (const operation of toolCall.args.operations) {
              await this.renderer.updateConversationNote({
                path: params.title,
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
                lang: params.lang,
                handlerId,
              });
            }
          }

          const updateInstructions = editToolExecute(toolCall.args);

          // Skip confirmation if no_confirm
          if (params.command.no_confirm) {
            return this.performUpdate({
              title: params.title,
              docs: [
                {
                  path: file.path,
                },
              ],
              updateInstructions,
              lang: params.lang,
              handlerId,
            });
          }

          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: t('update.applyChangesConfirm'),
            command: 'update',
            handlerId,
          });

          return {
            status: CommandResultStatus.NEEDS_CONFIRMATION,
            onConfirmation: () => {
              return this.performUpdate({
                title: params.title,
                docs: [
                  {
                    path: file.path,
                  },
                ],
                updateInstructions,
                lang: params.lang,
                handlerId,
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
    if (extraction.toolCalls.length > 0 && toolResults.length > 0) {
      // Calculate remaining steps
      const newRemainingSteps = remainingSteps > 0 ? remainingSteps - 1 : 0;

      // Continue handling if there are steps remaining
      if (newRemainingSteps > 0) {
        await this.renderer.serializeToolInvocation<unknown>({
          path: params.title,
          command: 'update',
          toolInvocations: toolResults,
        });

        await this.renderIndicator(params.title, params.lang);

        // Continue with updated conversation history (will be fetched fresh in the recursive call)
        return this.handleUpdateGeneratedOrReadContent({
          ...params,
          remainingSteps: newRemainingSteps,
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
    params: CommandHandlerParams & {
      handlerId: string;
    },
    artifact: ContentUpdateArtifact,
    docs: DocWithPath[]
  ): Promise<CommandResult> {
    const t = getTranslation(params.lang);
    const { execute } = createEditTool({
      contentType: 'in_the_note',
    });

    // Convert the updates in the extraction to UpdateInstruction objects
    const updateInstructions = execute(artifact.updateExtraction);

    if (updateInstructions.length === 0) {
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: t('update.noChangesNeeded'),
        lang: params.lang,
        handlerId: params.handlerId,
      });
      return {
        status: CommandResultStatus.SUCCESS,
      };
    }

    // Skip confirmation if no_confirm
    if (params.command.no_confirm) {
      return this.performUpdate({
        title: params.title,
        docs,
        updateInstructions,
        lang: params.lang,
        handlerId: params.handlerId,
      });
    }

    await this.renderer.updateConversationNote({
      path: params.title,
      newContent: t('update.applyChangesConfirm'),
      command: 'update',
      handlerId: params.handlerId,
    });

    return {
      status: CommandResultStatus.NEEDS_CONFIRMATION,
      onConfirmation: () => {
        return this.performUpdate({
          title: params.title,
          docs,
          updateInstructions,
          lang: params.lang,
          handlerId: params.handlerId,
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
    const { title, command, lang, handlerId = uniqueID() } = params;
    const t = getTranslation(lang);
    const conversationHistory = await this.renderer.extractConversationHistory(title, {
      summaryPosition: 1,
    });

    // Retrieve the most recent artifact of updatable types
    const artifact = await this.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes(updatableTypes);

    if (!artifact) {
      if (command.query.includes(STW_SELECTED_PLACEHOLDER)) {
        const originalQuery =
          this.plugin.commandProcessorService.commandProcessor.getPendingCommand(title)?.payload
            .originalQuery;
        command.query = this.restoreStwSelectedBlocks({ originalQuery, query: command.query });
      }

      const hasStwSelected = new RegExp(STW_SELECTED_PATTERN).test(command.query);

      if (hasStwSelected) {
        return this.handleUpdateStwSelected({
          ...params,
          handlerId,
          messages: [
            ...conversationHistory,
            { role: 'user', content: command.query, id: generateId() },
          ],
        });
      }

      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('common.noRecentOperations')}*`,
        command: 'update',
        handlerId,
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
    } else if (artifact.artifactType === ArtifactType.READ_CONTENT) {
      if (artifact.readingResult.blocks.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('update.noContentFound')}*`,
        });
        return {
          status: CommandResultStatus.SUCCESS,
        };
      }
    }

    // If we have a content update artifact, we can use it directly
    if (artifact.artifactType === ArtifactType.CONTENT_UPDATE) {
      return this.handleUpdateContentUpdate(
        {
          ...params,
          handlerId,
        },
        artifact,
        docs
      );
    }

    if (
      artifact.artifactType === ArtifactType.GENERATED_CONTENT ||
      artifact.artifactType === ArtifactType.READ_CONTENT
    ) {
      return this.handleUpdateGeneratedOrReadContent({
        ...params,
        handlerId,
        artifact,
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
      command: 'update',
      handlerId,
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
      handlerId,
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
    handlerId: string;
  }): Promise<CommandResult> {
    const { title, docs, updateInstructions, lang, handlerId } = params;
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
            let contentChanged = false;

            // Apply update instructions and write back atomically
            await this.app.vault.process(file, content => {
              // Apply each update instruction in sequence
              for (const instruction of updateInstructions) {
                const result = this.obsidianAPITools.applyUpdateInstruction(content, instruction);

                if (result !== content) {
                  content = result;
                  contentChanged = true;
                }
              }

              return content;
            });

            if (!contentChanged) {
              logger.log(`Skipping ${doc.path} because it didn't change`);
              skippedFiles.push(doc.path);
              continue;
            }

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
        handlerId,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error updating files: ${error.message}`,
        handlerId,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
