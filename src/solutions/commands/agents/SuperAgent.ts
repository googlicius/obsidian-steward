import { streamText, Message } from 'ai';
import { waitForError } from 'src/utils/waitForError';
import { Agent } from '../Agent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../types';
import { ToolInvocation } from '../tools/types';
import { getTranslation } from 'src/i18n';
import { SystemPromptModifier } from '../SystemPromptModifier';
import { ToolRegistry, ToolName } from '../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { activateTools } from '../tools/activateTools';
import { ArtifactType } from 'src/solutions/artifact';
import { getMostRecentArtifact, getArtifactById } from '../tools/getArtifact';
import { getClassifier } from 'src/lib/modelfusion';
import { logger } from 'src/utils/logger';
import { SuperAgentHandlers } from './SuperAgentHandlers';
import { applyMixins } from 'src/utils/applyMixins';
import { createAskUserTool } from '../tools/askUser';
import * as handlers from './handlers';
import { ConversationHistoryMessage } from 'src/types/types';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { streamTextWithReasoning } from 'src/utils/textStreamer';

/**
 * Map of task names to their associated tool names
 */
const TASK_TO_TOOLS_MAP: Record<string, Set<ToolName>> = {
  vault: new Set([
    ToolName.LIST,
    ToolName.CREATE,
    ToolName.DELETE,
    ToolName.COPY,
    ToolName.MOVE,
    ToolName.RENAME,
    ToolName.UPDATE_FRONTMATTER,
    ToolName.GREP,
  ]),
  revert: new Set([
    ToolName.REVERT_DELETE,
    ToolName.REVERT_MOVE,
    ToolName.REVERT_FRONTMATTER,
    ToolName.REVERT_RENAME,
    ToolName.REVERT_CREATE,
  ]),
  read: new Set([ToolName.CONTENT_READING]),
  edit: new Set([ToolName.EDIT]),
  user_confirm: new Set([ToolName.USER_CONFIRM]),
  more: new Set([ToolName.SEARCH_MORE]),
  stop: new Set([ToolName.STOP]),
  thank_you: new Set([ToolName.THANK_YOU]),
  build_search_index: new Set([ToolName.BUILD_SEARCH_INDEX]),
  search: new Set([ToolName.SEARCH]),
  speech: new Set([ToolName.SPEECH]),
  image: new Set([ToolName.IMAGE]),
};

/**
 * Map of task names to tools that should be default-activated
 */
const TASK_DEFAULT_ACTIVATE_TOOLS: Record<string, ToolName[]> = {
  revert: [ToolName.GET_MOST_RECENT_ARTIFACT, ToolName.GET_ARTIFACT_BY_ID],
  read: [ToolName.CONFIRMATION, ToolName.ASK_USER, ToolName.CONTENT_READING],
  edit: [ToolName.EDIT],
  search: [ToolName.SEARCH],
  speech: [ToolName.SPEECH],
  image: [ToolName.IMAGE],
};

/**
 * Map of task names to their loading indicator translation keys
 */
const TASK_TO_INDICATOR_MAP: Record<string, string> = {
  vault: 'conversation.working',
  revert: 'conversation.reverting',
  read: 'conversation.readingContent',
  edit: 'conversation.updating',
  speech: 'conversation.generatingAudio',
  image: 'conversation.generatingImage',
};

/**
 * These tasks should be processed in a single turn (Don't need a last evaluation)
 */
const SINGLE_TURN_TASKS = new Set(['search', 'search_more']);

const { askUserTool: confirmationTool } = createAskUserTool('confirmation');
const { askUserTool } = createAskUserTool('ask');

const tools = {
  [ToolName.LIST]: handlers.VaultList.getListTool(),
  [ToolName.CREATE]: handlers.VaultCreate.getCreateTool(),
  [ToolName.DELETE]: handlers.VaultDelete.getDeleteTool(),
  [ToolName.COPY]: handlers.VaultCopy.getCopyTool(),
  [ToolName.RENAME]: handlers.VaultRename.getRenameTool(),
  [ToolName.MOVE]: handlers.VaultMove.getMoveTool(),
  [ToolName.UPDATE_FRONTMATTER]: handlers.VaultUpdateFrontmatter.getUpdateFrontmatterTool(),
  [ToolName.GREP]: handlers.VaultGrep.getGrepTool(),
  [ToolName.REVERT_DELETE]: handlers.RevertDelete.getRevertDeleteTool(),
  [ToolName.REVERT_MOVE]: handlers.RevertMove.getRevertMoveTool(),
  [ToolName.REVERT_FRONTMATTER]: handlers.RevertFrontmatter.getRevertFrontmatterTool(),
  [ToolName.REVERT_RENAME]: handlers.RevertRename.getRevertRenameTool(),
  [ToolName.REVERT_CREATE]: handlers.RevertCreate.getRevertCreateTool(),
  [ToolName.CONTENT_READING]: handlers.ReadContent.getContentReadingTool(),
  [ToolName.CONFIRMATION]: confirmationTool,
  [ToolName.ASK_USER]: askUserTool,
  [ToolName.EDIT]: handlers.EditHandler.getEditTool('in_the_note'),
  [ToolName.USER_CONFIRM]: handlers.UserConfirm.getUserConfirmTool(),
  [ToolName.HELP]: handlers.Help.getHelpTool(),
  [ToolName.STOP]: handlers.Stop.getStopTool(),
  [ToolName.THANK_YOU]: handlers.ThankYou.getThankYouTool(),
  [ToolName.BUILD_SEARCH_INDEX]: handlers.BuildSearchIndex.getBuildSearchIndexTool(),
  [ToolName.SEARCH]: handlers.Search.getSearchTool(),
  [ToolName.SEARCH_MORE]: handlers.SearchMore.getSearchMoreTool(),
  [ToolName.GET_MOST_RECENT_ARTIFACT]: getMostRecentArtifact,
  [ToolName.GET_ARTIFACT_BY_ID]: getArtifactById,
  [ToolName.ACTIVATE]: activateTools,
  [ToolName.SPEECH]: handlers.Speech.getSpeechTool(),
  [ToolName.IMAGE]: handlers.Image.getImageTool(),
};

type ToolCalls = Awaited<
  Awaited<ReturnType<typeof streamText<typeof tools, unknown>>>['toolCalls']
>;

export interface SuperAgent extends Agent, SuperAgentHandlers {}

export class SuperAgent extends Agent {
  /**
   * Render the loading indicator for the super agent
   */
  public async renderIndicator(
    title: string,
    lang?: string | null,
    classifiedTasks?: string[]
  ): Promise<void> {
    const t = getTranslation(lang);

    // Determine which indicator to use based on classified tasks
    let indicatorKey = 'conversation.planning'; // Default indicator

    if (classifiedTasks && classifiedTasks.length > 0) {
      // Use the first task's indicator, or prioritize revert if present
      const priorityTask = classifiedTasks.includes('revert') ? 'revert' : classifiedTasks[0];

      indicatorKey = TASK_TO_INDICATOR_MAP[priorityTask] || indicatorKey;
    }

    await this.renderer.addGeneratingIndicator(title, t(indicatorKey));
  }

  /**
   * Craft a tool call without AI help
   */
  private async manualToolCall(
    title: string,
    query: string,
    activeTools: ToolName[],
    classifiedTasks: string[],
    lang?: string | null
  ): Promise<ToolInvocation<unknown> | undefined> {
    // Return undefined if there are multiple classified tasks
    console.log('classified tags', classifiedTasks);
    if (classifiedTasks.length !== 1) {
      return undefined;
    }

    const task = classifiedTasks[0];
    const t = getTranslation(lang);

    switch (task) {
      case 'vault': {
        // Handle DELETE tool manual calls (vault task)
        if (activeTools.length === 1 && activeTools.includes(ToolName.DELETE)) {
          const artifact = await this.plugin.artifactManagerV2
            .withTitle(title)
            .getMostRecentArtifactOfTypes([
              ArtifactType.SEARCH_RESULTS,
              ArtifactType.CREATED_NOTES,
              ArtifactType.LIST_RESULTS,
            ]);

          if (artifact) {
            return {
              toolName: ToolName.DELETE,
              toolCallId: `manual-tool-call-${uniqueID()}`,
              args: {
                artifactId: artifact.id,
                explanation: '',
              },
            };
          }
        }
        return undefined;
      }

      case 'revert': {
        // Handle revert tool manual calls for simple revert requests
        const trimmedQuery = query.trim();
        const words = trimmedQuery.split(/\s+/);

        // Single word revert commands
        const revertKeywords = ['undo', 'revert', 'rollback', 'cancel'];
        const isSimpleRevert =
          words.length === 1 && revertKeywords.includes(trimmedQuery.toLowerCase());

        if (isSimpleRevert) {
          // Get the most recent artifact from types created by VaultAgent
          const artifactTypes = [
            ArtifactType.MOVE_RESULTS,
            ArtifactType.CREATED_NOTES,
            ArtifactType.DELETED_FILES,
            ArtifactType.UPDATE_FRONTMATTER_RESULTS,
            ArtifactType.RENAME_RESULTS,
          ];

          const artifact = await this.plugin.artifactManagerV2
            .withTitle(title)
            .getMostRecentArtifactOfTypes(artifactTypes);

          if (artifact?.id) {
            // Map artifact type to the appropriate revert tool
            const artifactTypeToToolMap: Partial<Record<ArtifactType, ToolName>> = {
              [ArtifactType.MOVE_RESULTS]: ToolName.REVERT_MOVE,
              [ArtifactType.CREATED_NOTES]: ToolName.REVERT_CREATE,
              [ArtifactType.DELETED_FILES]: ToolName.REVERT_DELETE,
              [ArtifactType.UPDATE_FRONTMATTER_RESULTS]: ToolName.REVERT_FRONTMATTER,
              [ArtifactType.RENAME_RESULTS]: ToolName.REVERT_RENAME,
            };

            const toolName = artifactTypeToToolMap[artifact.artifactType];
            if (toolName) {
              return {
                toolName,
                toolCallId: `manual-tool-call-${uniqueID()}`,
                args: {
                  artifactId: artifact.id,
                  explanation: t('revert.revertingArtifact', {
                    artifactType: artifact.artifactType,
                  }),
                },
              };
            }
          }
        }
        return undefined;
      }

      case 'help': {
        return {
          toolName: ToolName.HELP,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {},
        };
      }

      case 'user_confirm': {
        return {
          toolName: ToolName.USER_CONFIRM,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {},
        };
      }

      case 'stop': {
        return {
          toolName: ToolName.STOP,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {},
        };
      }

      case 'thank_you': {
        return {
          toolName: ToolName.THANK_YOU,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {},
        };
      }

      case 'more': {
        // Handle search_more tool manual calls
        return {
          toolName: ToolName.SEARCH_MORE,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {},
        };
      }

      case 'build_search_index': {
        return {
          toolName: ToolName.BUILD_SEARCH_INDEX,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {},
        };
      }

      case 'search': {
        // Handle search tool manual calls
        const extraction = this.search.extractSearchQueryWithoutLLM({
          query,
          searchSettings: this.plugin.settings.search,
          lang,
        });

        if (extraction) {
          return {
            toolName: ToolName.SEARCH,
            toolCallId: `manual-tool-call-${uniqueID()}`,
            args: {
              operations: extraction.operations,
              explanation: extraction.explanation,
              lang: extraction.lang,
              confidence: extraction.confidence,
            },
          };
        }
        return undefined;
      }

      case 'speech': {
        // Handle speech tool manual calls
        const quotedText = getQuotedQuery(query);
        if (quotedText) {
          return {
            toolName: ToolName.SPEECH,
            toolCallId: `manual-tool-call-${uniqueID()}`,
            args: {
              text: quotedText,
              explanation: `Generating audio with: "${quotedText}"`,
              confidence: 1,
            },
          };
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }

  /**
   * Execute streamText with tools and handle streaming
   */
  private async executeStreamText(
    params: AgentHandlerParams,
    options: {
      classifiedTasks?: string[];
    } = {}
  ): Promise<{
    toolCalls: ToolCalls;
    conversationHistory: ConversationHistoryMessage[];
  }> {
    const conversationHistory = await this.renderer.extractConversationHistory(params.title, {
      summaryPosition: 1,
    });

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: params.intent.model,
      generateType: 'text',
    });

    const modifier = new SystemPromptModifier(params.intent.systemPrompts);
    const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

    const activeToolNames =
      params.activeTools && params.activeTools.length > 0
        ? [...params.activeTools, ToolName.ACTIVATE]
        : [ToolName.ACTIVATE];
    const registry = ToolRegistry.buildFromTools(tools, params.intent.tools).setActive(
      activeToolNames
    );

    // Exclude confirmation and ask_user tools if no_confirm is set
    if (params.intent.no_confirm) {
      registry.exclude([ToolName.CONFIRMATION, ToolName.ASK_USER]);
    }

    const messages: Message[] = conversationHistory;

    // Include user message for the first iteration.
    if (!params.invocationCount) {
      messages.push({ role: 'user', content: params.intent.query } as unknown as Message);
    }

    console.log('MESSAGES', messages);

    // Create an operation-specific abort signal
    const abortSignal = this.plugin.abortService.createAbortController('super-agent');

    // Collect the error from the stream to handle it with our handle function.
    let streamError: Error | null = null;

    const currentNote = await this.renderer.getConversationProperty<string>(
      params.title,
      'current_note'
    );

    // Use streamText instead of generateText
    const { toolCalls: toolCallsPromise, fullStream } = streamText({
      ...llmConfig,
      abortSignal,
      system: modifier.apply(`You are a helpful assistant who helps users with their Obsidian vault.

Your role is to help users with multiple tasks by using appropriate tools.
- For generating tasks, you can generate directly.
- For editing tasks, use ${ToolName.EDIT} tool.
- For vault management tasks, use the following tools: ${joinWithConjunction(
        [
          ToolName.LIST,
          ToolName.CREATE,
          ToolName.DELETE,
          ToolName.COPY,
          ToolName.MOVE,
          ToolName.RENAME,
          ToolName.UPDATE_FRONTMATTER,
        ],
        'and'
      )}.
- For other tasks, use the appropriate tool(s).

You have access to the following tools:
${registry.generateToolsSection()}

OTHER TOOLS:
${registry.generateOtherToolsSection('No other tools available.', new Set([ToolName.GREP, ToolName.LIST, ToolName.SEARCH, ToolName.IMAGE]))}

GUIDELINES:
${registry.generateGuidelinesSection()}

${currentNote ? `CURRENT NOTE: ${currentNote}` : ''}

NOTE:
- Do NOT repeat the latest tool call result in your final response as it is already rendered in the UI.
- Respect user's language or the language they specified. The lang property should be a valid language code: en, vi, etc.`),
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...messages,
      ],
      tools: registry.getToolsObject(),
      onError: ({ error }) => {
        streamError = error instanceof Error ? error : new Error(String(error));
      },
    });

    const streamErrorPromise = waitForError(() => streamError);

    // Stream the text directly to the conversation note
    await Promise.race([
      this.renderer.streamConversationNote({
        path: params.title,
        stream: streamTextWithReasoning(fullStream),
        handlerId: params.handlerId,
        step: params.invocationCount,
      }),
      streamErrorPromise,
    ]);

    // Render indicator after 2 seconds when still waiting for toolCalls.
    const timer = setTimeout(() => {
      this.renderIndicator(params.title, params.lang, options?.classifiedTasks);
    }, 500);

    // Wait for tool calls and extract the result
    const toolCalls = (await Promise.race([toolCallsPromise, streamErrorPromise])) as ToolCalls;

    clearTimeout(timer);

    return {
      toolCalls,
      conversationHistory,
    };
  }

  /**
   * Handle a super agent invocation
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      remainingSteps?: number;
      toolCalls?: unknown[];
      currentToolCallIndex?: number;
    } = {}
  ): Promise<AgentResult> {
    const { title, intent, lang } = params;
    const handlerId = params.handlerId ?? uniqueID();

    // Load activeTools from frontmatter if not provided in params
    const activeTools = await this.loadActiveTools(title, params.activeTools);

    const t = getTranslation(lang);

    let classifiedTasks: string[] = [];

    if (!params.invocationCount) {
      classifiedTasks = await this.classifyTasksFromQuery(intent.query, params.upstreamOptions);
    }

    if (!classifiedTasks.length) {
      classifiedTasks = this.classifyTasksFromActiveTools(activeTools);
    }

    // Default-activate tools based on classified tasks
    const defaultActivateTools = this.getDefaultActivateTools(classifiedTasks);
    if (defaultActivateTools.length > 0) {
      logger.log(`Default-activating tools: ${joinWithConjunction(defaultActivateTools, 'and')}`);
      // Add defaultActivateTools to activeTools if not already present
      for (const tool of defaultActivateTools) {
        if (!activeTools.includes(tool)) {
          activeTools.push(tool);
        }
      }
    }

    const MAX_STEP_COUNT = 10;
    const remainingSteps =
      typeof options.remainingSteps !== 'undefined' ? options.remainingSteps : MAX_STEP_COUNT;

    if (remainingSteps <= 0) {
      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    const manualToolCall = await this.manualToolCall(
      title,
      intent.query,
      activeTools,
      classifiedTasks,
      lang
    );

    let toolCalls: ToolCalls;
    let conversationHistory: ConversationHistoryMessage[] = [];

    if (options.toolCalls) {
      toolCalls = options.toolCalls as ToolCalls;
    } else if (manualToolCall) {
      toolCalls = [manualToolCall] as ToolCalls;
    } else {
      const result = await this.executeStreamText(
        {
          ...params,
          activeTools,
        },
        {
          classifiedTasks,
        }
      );
      toolCalls = result.toolCalls;
      conversationHistory = result.conversationHistory;
    }

    /**
     * Wrap a callback with resumption logic to continue processing tool calls after confirmation/user input
     */
    const wrapCallbackWithResumption = <T extends AgentResult>(
      originalCallback: (message: string) => Promise<T> | T,
      currentIndex: number
    ): ((message: string) => Promise<AgentResult>) => {
      return async (message: string): Promise<AgentResult> => {
        const callbackResult = await originalCallback(message);
        if (!callbackResult || callbackResult.status === IntentResultStatus.SUCCESS) {
          await this.renderIndicator(title, lang, classifiedTasks);
          // Resume processing by calling handle again with preserved state
          return this.handle(
            {
              ...params,
              activeTools,
            },
            {
              remainingSteps,
              toolCalls,
              currentToolCallIndex: currentIndex + 1,
            }
          );
        }
        return callbackResult;
      };
    };

    const processToolCalls = async (startIndex: number): Promise<AgentResult> => {
      for (let index = startIndex; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index];
        let toolCallResult: AgentResult | undefined;

        switch (toolCall.toolName) {
          case ToolName.LIST: {
            toolCallResult = await this.vaultList.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.CREATE: {
            toolCallResult = await this.vaultCreate.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.DELETE: {
            toolCallResult = await this.vaultDelete.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.COPY: {
            toolCallResult = await this.vaultCopy.handle(params, { toolCall });
            break;
          }

          case ToolName.RENAME: {
            toolCallResult = await this.vaultRename.handle(params, { toolCall });
            break;
          }

          case ToolName.MOVE: {
            toolCallResult = await this.vaultMove.handle(params, { toolCall });
            break;
          }

          case ToolName.UPDATE_FRONTMATTER: {
            toolCallResult = await this.vaultUpdateFrontmatter.handle(params, { toolCall });
            break;
          }

          case ToolName.GREP: {
            toolCallResult = await this.vaultGrep.handle(params, { toolCall });
            break;
          }

          case ToolName.REVERT_DELETE: {
            toolCallResult = await this.revertDelete.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.REVERT_MOVE: {
            toolCallResult = await this.revertMove.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.REVERT_FRONTMATTER: {
            toolCallResult = await this.revertFrontmatter.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.REVERT_RENAME: {
            toolCallResult = await this.revertRename.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.REVERT_CREATE: {
            toolCallResult = await this.revertCreate.handle(params, {
              toolCall,
            });
            break;
          }

          case ToolName.GET_MOST_RECENT_ARTIFACT: {
            // Get the most recent artifact from types created by VaultAgent
            const artifactTypes = [
              ArtifactType.MOVE_RESULTS,
              ArtifactType.CREATED_NOTES,
              ArtifactType.DELETED_FILES,
              ArtifactType.UPDATE_FRONTMATTER_RESULTS,
              ArtifactType.RENAME_RESULTS,
            ];

            const artifact = await this.plugin.artifactManagerV2
              .withTitle(title)
              .getMostRecentArtifactOfTypes(artifactTypes);

            const result = artifact?.id
              ? `artifactRef:${artifact.id}`
              : {
                  error:
                    t('common.noArtifactsFound') ||
                    'No artifacts found matching the specified types.',
                };

            await this.renderer.serializeToolInvocation({
              path: title,
              command: 'get-artifact',
              handlerId,
              toolInvocations: [
                {
                  ...toolCall,
                  result,
                },
              ],
            });
            break;
          }

          case ToolName.GET_ARTIFACT_BY_ID: {
            const artifact = await this.plugin.artifactManagerV2
              .withTitle(title)
              .getArtifactById(toolCall.args.artifactId);

            const result = artifact?.id
              ? `artifactRef:${artifact.id}`
              : {
                  error: t('common.artifactNotFound', { artifactId: toolCall.args.artifactId }),
                };

            await this.renderer.serializeToolInvocation({
              path: title,
              command: 'get-artifact',
              handlerId,
              toolInvocations: [
                {
                  ...toolCall,
                  result,
                },
              ],
            });
            break;
          }

          case ToolName.CONTENT_READING: {
            toolCallResult = await this.readContent.handle(params, {
              toolCall,
              nextIntent: params.nextIntent,
            });
            break;
          }

          case ToolName.CONFIRMATION:
          case ToolName.ASK_USER: {
            await this.renderer.updateConversationNote({
              path: title,
              newContent: toolCall.args.message,
              lang: params.lang,
              handlerId,
            });

            const callBack = async (message: string): Promise<AgentResult> => {
              // Serialize the tool invocation with the user's response
              await this.renderer.serializeToolInvocation({
                path: title,
                handlerId,
                toolInvocations: [
                  {
                    ...toolCall,
                    result: message,
                  },
                ],
              });

              await this.renderIndicator(title, lang, classifiedTasks);

              // Increment invocation count for recursive call
              const nextParams = {
                ...params,
                activeTools,
                invocationCount: (params.invocationCount ?? 0) + 1,
              };

              return this.handle(nextParams, {
                remainingSteps,
              });
            };

            if (toolCall.toolName === ToolName.CONFIRMATION) {
              toolCallResult = {
                status: IntentResultStatus.NEEDS_CONFIRMATION,
                onConfirmation: callBack,
              };
            } else {
              toolCallResult = {
                status: IntentResultStatus.NEEDS_USER_INPUT,
                onUserInput: callBack,
              };
            }
            break;
          }

          case ToolName.EDIT: {
            toolCallResult = await this.editHandler.handle(params, { toolCall });
            break;
          }

          case ToolName.USER_CONFIRM: {
            toolCallResult = await this.userConfirm.handle(params, { toolCall });
            break;
          }

          case ToolName.HELP: {
            toolCallResult = await this.help.handle(params);
            break;
          }

          case ToolName.STOP: {
            toolCallResult = await this.stop.handle(params, { toolCall });
            break;
          }

          case ToolName.THANK_YOU: {
            toolCallResult = await this.thankYou.handle(params, { toolCall });
            break;
          }

          case ToolName.BUILD_SEARCH_INDEX: {
            toolCallResult = await this.buildSearchIndex.handle(params, { toolCall });
            break;
          }

          case ToolName.SEARCH: {
            toolCallResult = await this.search.handle(params, { toolCall });
            break;
          }

          case ToolName.SEARCH_MORE: {
            toolCallResult = await this.searchMore.handle(params, { toolCall });
            break;
          }

          case ToolName.ACTIVATE: {
            toolCallResult = await this.activateToolHandler.handle(params, {
              toolCall,
              activeTools,
              availableTools: tools,
              agent: 'super',
            });
            break;
          }

          case ToolName.SPEECH: {
            toolCallResult = await this.speech.handle(params, { toolCall });
            break;
          }

          case ToolName.IMAGE: {
            toolCallResult = await this.image.handle(params, { toolCall });
            break;
          }

          default:
            break;
        }

        if (!toolCallResult) {
          continue;
        }

        if (toolCallResult.status === IntentResultStatus.NEEDS_CONFIRMATION) {
          const originalOnConfirmation = toolCallResult.onConfirmation;
          const originalOnFinal = toolCallResult.onFinal;
          // Wrap the callback to call onFinal before resumption
          const wrappedCallback = async (message: string) => {
            const confirmationResult = await originalOnConfirmation(message);
            if (!confirmationResult || confirmationResult.status === IntentResultStatus.SUCCESS) {
              if (originalOnFinal) {
                await originalOnFinal();
              }
            }
            return confirmationResult;
          };
          return {
            ...toolCallResult,
            onConfirmation: wrapCallbackWithResumption(wrappedCallback, index),
          };
        }

        if (toolCallResult.status === IntentResultStatus.NEEDS_USER_INPUT) {
          return {
            ...toolCallResult,
            onUserInput: wrapCallbackWithResumption(toolCallResult.onUserInput, index),
          };
        }

        if (
          toolCallResult.status === IntentResultStatus.ERROR ||
          toolCallResult.status === IntentResultStatus.STOP_PROCESSING
        ) {
          return toolCallResult;
        }
      }

      return {
        status: IntentResultStatus.SUCCESS,
      };
    };

    // Use the saved index if resuming after confirmation, otherwise start from 0
    const startIndex = options.currentToolCallIndex ?? 0;
    const toolProcessingResult = await processToolCalls(startIndex);

    if (toolProcessingResult.status !== IntentResultStatus.SUCCESS || manualToolCall) {
      return toolProcessingResult;
    }

    const nextRemainingSteps = remainingSteps - 1;

    // classifiedTasks = this.classifyTasksFromActiveTools(activeTools);

    if (
      toolCalls.length > 0 &&
      nextRemainingSteps > 0 &&
      !this.stopProcessingForClassifiedTask(classifiedTasks)
    ) {
      // Update indicator to show we're still working
      await this.renderIndicator(title, lang, classifiedTasks);

      // Increment invocation count for recursive call
      const nextParams = {
        ...params,
        activeTools,
        invocationCount: (params.invocationCount ?? 0) + 1,
      };

      return this.handle(nextParams, {
        remainingSteps: nextRemainingSteps,
      });
    }

    // Save classified tasks as embedding for the first user query only
    if (
      conversationHistory.length > 0 &&
      conversationHistory.filter(message => message.role === 'user').length === 1
    ) {
      if (classifiedTasks.length > 0) {
        await this.saveClassifiedTasksAsEmbedding(
          intent.query,
          classifiedTasks,
          params.upstreamOptions
        );
      }
    }

    // Save activeTools to frontmatter after successful completion
    if (toolProcessingResult.status === IntentResultStatus.SUCCESS && activeTools.length > 0) {
      await this.renderer.updateConversationFrontmatter(title, [
        {
          name: 'tools',
          value: activeTools,
        },
      ]);
    }

    return toolProcessingResult;
  }

  /**
   * Stop processing for specific classified tasks
   * @param classifiedTasks
   */
  private stopProcessingForClassifiedTask(classifiedTasks: string[]): boolean {
    if (classifiedTasks.length > 1) return false;

    const task = classifiedTasks[0];

    if (SINGLE_TURN_TASKS.has(task)) return true;

    return false;
  }

  /**
   * Classify tasks from query using classifier
   */
  private async classifyTasksFromQuery(
    query: string,
    upstreamOptions?: AgentHandlerParams['upstreamOptions']
  ): Promise<string[]> {
    // Check if classification should be ignored
    const ignoreClassify =
      upstreamOptions?.ignoreClassify ?? !this.plugin.settings.embedding.enabled;

    if (ignoreClassify) {
      return [];
    }

    const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
    const classifier = getClassifier(embeddingSettings, upstreamOptions?.isReloadRequest ?? false);
    const clusterName = await classifier.doClassify(query);

    if (!clusterName) {
      return [];
    }

    logger.log(`The user input was classified as "${clusterName}"`);
    // Split cluster name by ':' to get tasks (e.g., "vault:revert" -> ["vault", "revert"])
    const classifiedTasks = clusterName.split(':').filter(task => task.length > 0);

    return classifiedTasks;
  }

  /**
   * Classify tasks from activeTools
   */
  private classifyTasksFromActiveTools(activeTools: ToolName[]): string[] {
    const classifiedTasks: string[] = [];
    const activeToolsSet = new Set(activeTools);

    for (const [task, taskTools] of Object.entries(TASK_TO_TOOLS_MAP)) {
      // Check if any tool from this task is in activeTools
      const hasTaskTool = Array.from(taskTools).some(tool => activeToolsSet.has(tool));
      if (hasTaskTool) {
        classifiedTasks.push(task);
      }
    }

    return classifiedTasks;
  }

  /**
   * Get tools to default-activate based on classified tasks
   */
  private getDefaultActivateTools(classifiedTasks: string[]): ToolName[] {
    const defaultActivateTools: ToolName[] = [];

    for (const task of classifiedTasks) {
      const taskTools = TASK_DEFAULT_ACTIVATE_TOOLS[task];
      if (taskTools) {
        defaultActivateTools.push(...taskTools);
      }
    }

    return defaultActivateTools;
  }

  /**
   * Save classified tasks as embedding for the first query of the conversation
   * This helps improve future classification accuracy
   */
  private async saveClassifiedTasksAsEmbedding(
    query: string,
    classifiedTasks: string[],
    upstreamOptions?: AgentHandlerParams['upstreamOptions']
  ): Promise<void> {
    // Check if classification should be ignored
    const ignoreClassify =
      upstreamOptions?.ignoreClassify ?? !this.plugin.settings.embedding.enabled;

    if (ignoreClassify || classifiedTasks.length === 0) {
      return;
    }

    try {
      const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
      const classifier = getClassifier(
        embeddingSettings,
        upstreamOptions?.isReloadRequest ?? false
      );

      // Create cluster name from classified tasks
      const clusterName = classifiedTasks.join(':');

      // Save embedding without awaiting to avoid blocking
      classifier.saveEmbedding(query, clusterName).catch(err => {
        logger.error('Failed to save embedding:', err);
      });
    } catch (error) {
      logger.error('Failed to save classified tasks as embedding:', error);
    }
  }
}

// Apply mixins to merge SuperAgentHandlers into SuperAgent
applyMixins(SuperAgent, [SuperAgentHandlers]);
