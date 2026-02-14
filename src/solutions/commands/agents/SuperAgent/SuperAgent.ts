import { ModelMessage, streamText } from 'ai';
import { Agent } from '../../Agent';
import { AgentHandlerParams, AgentResult, IntentResultStatus, Intent } from '../../types';
import { ToolCallPart, ToolResultPart } from '../../tools/types';
import { getTranslation } from 'src/i18n';
import { ToolRegistry, ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { activateTools } from '../../tools/activateTools';
import { ArtifactType, revertAbleArtifactTypes } from 'src/solutions/artifact';
import { getMostRecentArtifact, getArtifactById } from '../../tools/getArtifact';
import { getClassifier } from 'src/lib/modelfusion';
import { logger } from 'src/utils/logger';
import { SuperAgentHandlers } from './SuperAgentHandlers';
import { applyMixins } from 'src/utils/applyMixins';
import { createAskUserTool } from '../../tools/askUser';
import * as handlers from '../handlers';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { createTextReasoningStream } from 'src/utils/textStreamer';
import { SysError } from 'src/utils/errors';

/**
 * Map of task names to their associated tool names.
 * This is used to determine the tasks for classification based on the active tools.
 * Defaulting active tools from the classified tasks.
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
    ToolName.REVERT_EDIT_RESULTS,
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
  search: 'conversation.searching',
};

/**
 * These tasks should be processed in a single turn (Don't need a last evaluation)
 */
const SINGLE_TURN_TASKS = new Set(['search_1']);

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
  [ToolName.REVERT_EDIT_RESULTS]: handlers.RevertEditResults.getRevertEditResultsTool(),
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
  [ToolName.TODO_LIST]: handlers.TodoList.getTodoListTool(),
  [ToolName.TODO_LIST_UPDATE]: handlers.TodoList.getTodoListUpdateTool(),
  [ToolName.USE_SKILLS]: handlers.UseSkills.getUseSkillsTool(),
  [ToolName.CONCLUDE]: handlers.Conclude.getConcludeTool(),
};

const toolsThatEnableConclude = new Set([
  ToolName.EDIT,
  ToolName.MOVE,
  ToolName.COPY,
  ToolName.DELETE,
  ToolName.RENAME,
  ToolName.CREATE,
  ToolName.UPDATE_FRONTMATTER,
]);

type ToolCalls = Awaited<Awaited<ReturnType<typeof streamText<typeof tools>>>['toolCalls']>;

export interface SuperAgent extends Agent, SuperAgentHandlers {}

export class SuperAgent extends Agent {
  /**
   * Render the loading indicator for the super agent
   */
  public async renderIndicator(
    title: string,
    lang?: string | null,
    toolName?: ToolName
  ): Promise<void> {
    const t = getTranslation(lang);

    // Determine which indicator to use
    let indicatorKey = 'conversation.planning'; // Default indicator

    // Use tool name to determine the indicator
    if (toolName) {
      const task = this.getTaskForTool(toolName);
      if (task) {
        indicatorKey = TASK_TO_INDICATOR_MAP[task] || indicatorKey;
      }
    }

    await this.renderer.addGeneratingIndicator(title, t(indicatorKey));
  }

  /**
   * Client-made tool call without AI
   */
  protected async manualToolCall(params: {
    title: string;
    query: string;
    activeTools: ToolName[];
    classifiedTasks: string[];
    lang?: string | null;
    /**
     * When set, indicates how the task was classified (static/prefixed/clustered).
     * For build_search_index, manual tool call (index everything) is only used when matchType is 'static'.
     */
    classificationMatchType?: 'static' | 'prefixed' | 'clustered';
  }): Promise<ToolCallPart | undefined> {
    const { title, query, activeTools, classifiedTasks, lang, classificationMatchType } = params;

    // Return undefined if there are multiple classified tasks
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
              type: 'tool-call',
              toolName: ToolName.DELETE,
              toolCallId: `manual-tool-call-${uniqueID()}`,
              input: {
                operations: [
                  {
                    mode: 'artifactId',
                    artifactId: artifact.id,
                  },
                ],
              },
            } as ToolCallPart<handlers.DeleteToolArgs>;
          }
        }
        return undefined;
      }

      case 'revert': {
        // Handle revert tool manual calls for static cluster: revert
        if (classificationMatchType === 'static') {
          // Get the most recent artifact from types created by VaultAgent
          const artifactTypes = [
            ArtifactType.MOVE_RESULTS,
            ArtifactType.CREATED_NOTES,
            ArtifactType.DELETED_FILES,
            ArtifactType.UPDATE_FRONTMATTER_RESULTS,
            ArtifactType.RENAME_RESULTS,
            ArtifactType.EDIT_RESULTS,
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
              [ArtifactType.EDIT_RESULTS]: ToolName.REVERT_EDIT_RESULTS,
            };

            const toolName = artifactTypeToToolMap[artifact.artifactType];
            if (toolName) {
              return {
                type: 'tool-call',
                toolName,
                toolCallId: `manual-tool-call-${uniqueID()}`,
                input: {
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
          type: 'tool-call',
          toolName: ToolName.HELP,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'user_confirm': {
        return {
          type: 'tool-call',
          toolName: ToolName.USER_CONFIRM,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'stop': {
        return {
          type: 'tool-call',
          toolName: ToolName.STOP,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'thank_you': {
        return {
          type: 'tool-call',
          toolName: ToolName.THANK_YOU,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'more': {
        // Handle search_more tool manual calls
        return {
          type: 'tool-call',
          toolName: ToolName.SEARCH_MORE,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'build_search_index': {
        // Only use manual tool call (index everything) when static cluster matched.
        // Clustered match may indicate user wants specific folders (e.g. "index my files in Projects").
        if (classificationMatchType !== 'static') {
          return undefined;
        }
        return {
          type: 'tool-call',
          toolName: ToolName.BUILD_SEARCH_INDEX,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
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
            type: 'tool-call',
            toolName: ToolName.SEARCH,
            toolCallId: `manual-tool-call-${uniqueID()}`,
            input: {
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
            type: 'tool-call',
            toolName: ToolName.SPEECH,
            toolCallId: `manual-tool-call-${uniqueID()}`,
            input: {
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
  private async executeStreamText(params: AgentHandlerParams): Promise<{
    toolCalls: ToolCalls;
    conversationHistory: ModelMessage[];
  }> {
    let timer: number | null = null;

    try {
      const conversationHistory = await this.renderer.extractConversationHistory(params.title, {
        summaryPosition: 1,
      });

      const llmConfig = await this.plugin.llmService.getLLMConfig({
        overrideModel: params.intent.model,
        generateType: 'text',
      });

      const shouldUseTools = params.intent.use_tool !== false;
      const baseActiveTools =
        params.activeTools && params.activeTools.length > 0 ? params.activeTools : [];
      const hasConcludeEligibleTool = baseActiveTools.some(t => toolsThatEnableConclude.has(t));
      const activeToolNames = shouldUseTools
        ? [
            ...baseActiveTools,
            ToolName.ACTIVATE,
            ...(hasConcludeEligibleTool ? [ToolName.CONCLUDE] : []),
          ]
        : [];

      const registry = ToolRegistry.buildFromTools(tools).setActive(activeToolNames);

      // Exclude confirmation and ask_user tools if no_confirm is set
      if (params.intent.no_confirm) {
        registry.exclude([ToolName.CONFIRMATION, ToolName.ASK_USER]);
      }

      // Create a copy of conversationHistory to avoid mutating the original array
      const messages = [...conversationHistory];

      // Include user message for the first iteration.
      if (!params.invocationCount) {
        messages.push({ role: 'user', content: params.intent.query });
      }

      // Validate image support before sending messages
      // This will throw an error if images are present but model doesn't support vision
      this.plugin.llmService.validateImageSupport(
        params.intent.model || this.plugin.settings.llm.chat.model,
        messages,
        params.lang
      );

      // Create an operation-specific abort signal
      const abortSignal = this.plugin.abortService.createAbortController('super-agent');

      /**
       * Create a deferred promise that rejects immediately when an error or abort occurs.
       * This is needed because AI SDK v5 swallows abort errors and throws NoOutputGeneratedError,
       * and the polling-based waitForError is too slow to catch errors before promises reject.
       */
      let rejectStreamError: (error: Error) => void;
      const streamErrorPromise = new Promise<never>((_, reject) => {
        rejectStreamError = reject;
      });

      const currentNote = await this.renderer.getConversationProperty<string>(
        params.title,
        'current_note'
      );

      let currentPosition: number | null = null;
      if (currentNote) {
        const cursor = this.plugin.editor.getCursor();
        currentPosition = cursor.line;
      }

      // Generate to-do list prompt only if TODO_LIST_UPDATE tool is active
      const todoListPrompt = activeToolNames.includes(ToolName.TODO_LIST_UPDATE)
        ? await this.generateTodoListPrompt(params.title)
        : '';

      // Generate skill catalog
      const skillCatalogPrompt = this.generateSkillCatalogPrompt();

      const shouldUseCoreSystemPrompt = shouldUseTools;

      const additionalSystemPrompts = params.intent.systemPrompts || [];

      if (llmConfig.systemPrompt) {
        additionalSystemPrompts.push(llmConfig.systemPrompt);
      }

      // Inject each active skill as a separate system prompt to avoid formatting conflicts
      const activeSkillPrompts = this.generateActiveSkillPrompts(params.activeSkills || []);
      additionalSystemPrompts.push(...activeSkillPrompts);

      if (additionalSystemPrompts.length > 0) {
        messages.unshift({ role: 'system', content: additionalSystemPrompts.join('\n\n') });
      }

      // Track the tool detected from the stream
      let detectedTool: ToolName | undefined;

      const coreSystemPrompt = `You are a helpful assistant who helps users with their Obsidian vault.

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
- For tasks that require domain-specific knowledge, activate the relevant skill(s) first using ${ToolName.USE_SKILLS}.
- For other tasks, use the appropriate tool(s).

You have access to the following tools:
${registry.generateToolsSection()}

OTHER TOOLS (Inactive):
${registry.generateOtherToolsSection(
  'No other tools available.',
  new Set([
    ToolName.GREP,
    ToolName.LIST,
    ToolName.SEARCH,
    ToolName.IMAGE,
    ToolName.CONTENT_READING,
    ToolName.TODO_LIST,
  ]),
  new Set([ToolName.TODO_LIST_UPDATE, ToolName.SEARCH_MORE, ToolName.CONCLUDE])
)}

TOOLS GUIDELINES:
${registry.generateGuidelinesSection()}
${currentNote ? `\nCURRENT NOTE: ${currentNote} (Cursor position: ${currentPosition})` : ''}${todoListPrompt}${skillCatalogPrompt}

NOTE:
- Do NOT repeat the latest tool call result in your final response as it is already rendered in the UI.
- Do NOT mention the tools you use to users. Work silently in the background and only communicate the results or outcomes.
- Respect user's language or the language they specified. The lang property should be a valid language code: en, vi, etc.`;

      type RepairToolCall = Parameters<typeof streamText>[0]['experimental_repairToolCall'];

      const { toolCalls: toolCallsPromise, fullStream } = streamText({
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        maxOutputTokens: llmConfig.maxOutputTokens,
        abortSignal,
        system: shouldUseCoreSystemPrompt ? coreSystemPrompt : undefined,
        messages,
        tools: shouldUseTools ? registry.getToolsObject() : undefined,
        experimental_repairToolCall: llmConfig.repairToolCall as RepairToolCall,
        onError: ({ error }) => {
          logger.error('Error in streamText', error);
          rejectStreamError(error as Error);
        },
        onAbort: () => {
          // AI SDK v5 swallows abort errors and throws NoOutputGeneratedError instead.
          // We need to reject immediately with the proper AbortError.
          rejectStreamError(new DOMException('Request aborted', 'AbortError'));
        },
        onChunk: async ({ chunk }) => {
          if (chunk.type === 'tool-call') {
            detectedTool = chunk.toolName as ToolName;
          }
        },
        onFinish: ({ finishReason }) => {
          if (finishReason === 'length') {
            rejectStreamError(new SysError('Stream finished due to length limit'));
          } else if (finishReason === 'error') {
            rejectStreamError(new SysError('Stream finished due to error'));
          }
        },
      });

      // Create text/reasoning stream with early completion signal and tool detection
      const { stream: textReasoningStream, textDone } = createTextReasoningStream(fullStream);

      // Stream the text directly to the conversation note (runs in background)
      const streamPromise = this.renderer.streamConversationNote({
        path: params.title,
        stream: textReasoningStream,
        handlerId: params.handlerId,
        step: params.invocationCount,
      });

      // Wait for text/reasoning to finish streaming (before tool calls)
      await Promise.race([textDone, streamErrorPromise]);

      // Render indicator after sometime when still waiting for toolCalls
      // Use detected tool if available
      timer = window.setTimeout(() => {
        this.renderIndicator(params.title, params.lang, detectedTool);
      }, 1000);

      // Wait for tool calls and extract the result
      const toolCalls = (await Promise.race([toolCallsPromise, streamErrorPromise])) as ToolCalls;

      // Ensure the stream is fully consumed (cleanup)
      await streamPromise.catch(() => {
        // Ignore errors here, they're handled by streamErrorPromise
      });

      return {
        toolCalls,
        conversationHistory,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Handle a super agent invocation
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      remainingSteps?: number;
      toolCalls?: ToolCalls;
      currentToolCallIndex?: number;
    } = {}
  ): Promise<AgentResult> {
    const { title, intent, lang } = params;
    const handlerId = params.handlerId ?? uniqueID();

    const MAX_STEP_COUNT = 20;
    const remainingSteps =
      typeof options.remainingSteps !== 'undefined' ? options.remainingSteps : MAX_STEP_COUNT;

    const activeTools = await this.loadActiveTools(title, params.activeTools);
    const activeSkills = await this.loadActiveSkills(title);

    const t = getTranslation(lang);

    let classifiedTasks: string[] = [];

    // Treat type (Usually from UDC step name) as a classified task
    if (intent.type.trim().length > 0 && !classifiedTasks.includes(intent.type)) {
      classifiedTasks.push(intent.type);
    }

    let classificationMatchType: 'static' | 'prefixed' | 'clustered' | undefined;

    if (!params.invocationCount && classifiedTasks.length === 0) {
      const classificationResult = await this.classifyTasksFromQuery(
        intent.query,
        params.upstreamOptions
      );
      classifiedTasks = classificationResult.tasks;
      classificationMatchType = classificationResult.matchType;
    }

    if (!classifiedTasks.length && activeTools.length > 0) {
      classifiedTasks = this.classifyTasksFromActiveTools(activeTools);
    }

    // Default-activate tools based on classified tasks
    const defaultActivateTools = this.getDefaultActivateTools(classifiedTasks);
    if (defaultActivateTools.length > 0) {
      // Track initial length to detect changes
      const initialLength = activeTools.length;

      // Add defaultActivateTools to activeTools if not already present
      for (const tool of defaultActivateTools) {
        if (!activeTools.includes(tool)) {
          activeTools.push(tool);
        }
      }

      // Save activeTools to frontmatter if changes were made
      if (activeTools.length > initialLength) {
        await this.renderer.updateConversationFrontmatter(title, [
          {
            name: 'tools',
            value: activeTools,
          },
        ]);
      }
    }

    // Add user message to conversation note for the first iteration
    if (!params.invocationCount) {
      await this.renderer.addUserMessage({
        path: title,
        newContent: intent.query,
        step: params.invocationCount,
        contentFormat: 'hidden',
      });
    }

    const manualToolCall = await this.manualToolCall({
      title,
      query: intent.query,
      activeTools,
      classifiedTasks,
      lang,
      classificationMatchType,
    });

    let toolCalls: ToolCalls;
    let conversationHistory: ModelMessage[] = [];

    if (options.toolCalls) {
      toolCalls = options.toolCalls;
    } else if (manualToolCall) {
      toolCalls = [manualToolCall] as ToolCalls;
    } else {
      const result = await this.executeStreamText({
        ...params,
        activeTools,
        activeSkills,
      });
      toolCalls = result.toolCalls;
      conversationHistory = result.conversationHistory;
    }

    /**
     * Interface for standard tool handlers
     */
    interface StandardToolHandler {
      handle(
        params: AgentHandlerParams,
        options: { toolCall: ToolCallPart<unknown> }
      ): Promise<AgentResult>;
    }

    /**
     * Map of tool names to their handler getters
     * Handlers that follow the standard pattern: handle(params, { toolCall })
     */
    const handlerMap: Partial<Record<ToolName, () => StandardToolHandler>> = {
      [ToolName.CONTENT_READING]: () => this.readContent,
      [ToolName.LIST]: () => this.vaultList,
      [ToolName.CREATE]: () => this.vaultCreate,
      [ToolName.DELETE]: () => this.vaultDelete,
      [ToolName.COPY]: () => this.vaultCopy,
      [ToolName.RENAME]: () => this.vaultRename,
      [ToolName.MOVE]: () => this.vaultMove,
      [ToolName.UPDATE_FRONTMATTER]: () => this.vaultUpdateFrontmatter,
      [ToolName.GREP]: () => this.vaultGrep,
      [ToolName.REVERT_DELETE]: () => this.revertDelete,
      [ToolName.REVERT_MOVE]: () => this.revertMove,
      [ToolName.REVERT_FRONTMATTER]: () => this.revertFrontmatter,
      [ToolName.REVERT_RENAME]: () => this.revertRename,
      [ToolName.REVERT_CREATE]: () => this.revertCreate,
      [ToolName.REVERT_EDIT_RESULTS]: () => this.revertEditResults,
      [ToolName.USER_CONFIRM]: () => this.userConfirm,
      [ToolName.EDIT]: () => this.editHandler,
      [ToolName.STOP]: () => this.stop,
      [ToolName.THANK_YOU]: () => this.thankYou,
      [ToolName.BUILD_SEARCH_INDEX]: () => this.buildSearchIndex,
      [ToolName.SEARCH]: () => this.search,
      [ToolName.SEARCH_MORE]: () => this.searchMore,
      [ToolName.SPEECH]: () => this.speech,
      [ToolName.IMAGE]: () => this.image,
      [ToolName.TODO_LIST]: () => this.todoList,
      [ToolName.HELP]: () => this.help,
      [ToolName.CONCLUDE]: () => this.conclude,
    };

    const processToolCalls = async (startIndex: number): Promise<AgentResult> => {
      // Set up timer to show indicator after 2 seconds if processing takes time
      let timer: number | null = null;
      // Get the first tool name from toolCalls if available
      const firstToolName =
        toolCalls.length > startIndex && !toolCalls[startIndex]?.dynamic
          ? (toolCalls[startIndex].toolName as ToolName)
          : undefined;
      timer = window.setTimeout(() => {
        this.renderIndicator(title, lang, firstToolName);
      }, 2000);

      try {
        for (let index = startIndex; index < toolCalls.length; index += 1) {
          const toolCall = toolCalls[index];
          let toolCallResult: AgentResult | undefined;

          if (toolCall.dynamic) {
            await this.dynamic.handle(params, { toolCall, tools });
            continue;
          }

          // Update language if provided in the tool call input
          if ('lang' in toolCall.input) {
            await this.renderer.updateConversationFrontmatter(title, [
              {
                name: 'lang',
                value: toolCall.input.lang,
              },
            ]);
            params.lang = toolCall.input.lang;
          }

          switch (toolCall.toolName) {
            case ToolName.GET_MOST_RECENT_ARTIFACT: {
              const artifact = await this.plugin.artifactManagerV2
                .withTitle(title)
                .getMostRecentArtifactOfTypes(revertAbleArtifactTypes);

              const result = artifact?.id
                ? `artifactRef:${artifact.id}`
                : t('common.noArtifactsFound');

              await this.renderer.serializeToolInvocation({
                path: title,
                command: 'get-artifact',
                handlerId,
                toolInvocations: [
                  {
                    ...toolCall,
                    type: 'tool-result',
                    output: {
                      type: 'text',
                      value: result,
                    },
                  },
                ],
              });

              toolCallResult = {
                status: IntentResultStatus.SUCCESS,
              };
              break;
            }

            case ToolName.GET_ARTIFACT_BY_ID: {
              const artifact = await this.plugin.artifactManagerV2
                .withTitle(title)
                .getArtifactById(toolCall.input.artifactId);

              const result = artifact?.id
                ? `artifactRef:${artifact.id}`
                : t('common.artifactNotFound', { artifactId: toolCall.input.artifactId });

              await this.renderer.serializeToolInvocation({
                path: title,
                command: 'get-artifact',
                handlerId,
                toolInvocations: [
                  {
                    ...toolCall,
                    type: 'tool-result',
                    output: {
                      type: 'text',
                      value: result,
                    },
                  },
                ],
              });

              toolCallResult = {
                status: IntentResultStatus.SUCCESS,
              };
              break;
            }

            case ToolName.CONFIRMATION:
            case ToolName.ASK_USER: {
              await this.renderer.updateConversationNote({
                path: title,
                newContent: toolCall.input.message,
                lang: params.lang,
                handlerId,
                includeHistory: false,
              });

              const callBack = async (): Promise<AgentResult> => {
                // Increment invocation count for recursive call
                params.invocationCount = (params.invocationCount ?? 0) + 1;

                return this.handle(params, {
                  remainingSteps,
                  toolCalls,
                  currentToolCallIndex: index + 1,
                });
              };

              if (toolCall.toolName === ToolName.CONFIRMATION) {
                toolCallResult = {
                  status: IntentResultStatus.NEEDS_CONFIRMATION,
                  toolCall,
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

            case ToolName.ACTIVATE: {
              toolCallResult = await this.activateToolHandler.handle(params, {
                toolCall,
                activeTools,
                availableTools: tools,
                agent: 'super',
              });
              break;
            }

            case ToolName.TODO_LIST_UPDATE: {
              toolCallResult = await this.todoList.handleUpdate(params, { toolCall });
              break;
            }

            case ToolName.USE_SKILLS: {
              toolCallResult = await this.useSkills.handle(params, {
                toolCall,
                activeSkills,
              });
              break;
            }

            case ToolName.CONCLUDE: {
              const prevToolCall = toolCalls.length > 1 && toolCalls[index - 1];
              // The in-parallel tool call incorrect, skip conclusion.
              if (prevToolCall && prevToolCall.dynamic) {
                continue;
              }
              if (toolCalls.length === 1) {
                logger.warn(`Conclude tool was called alone.`);
              }
              toolCallResult = await this.conclude.handle(params, { toolCall });
              break;
            }

            default: {
              // Try to find handler in the map for standard handlers
              const toolName = toolCall.toolName as ToolName;
              const handlerGetter = handlerMap[toolName];
              if (handlerGetter) {
                const handler = handlerGetter();
                toolCallResult = await handler.handle(params, { toolCall });
              } else {
                throw new Error(`No handler found for tool: ${toolName}`);
              }
              break;
            }
          }

          if (!toolCallResult) {
            logger.warn('No tool result', { toolCall, toolCalls });
            continue;
          }

          if (toolCallResult.status !== IntentResultStatus.SUCCESS) {
            return toolCallResult;
          }
        }

        return {
          status: IntentResultStatus.SUCCESS,
        };
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };
    // End processToolCalls function

    // Use the saved index if resuming after confirmation, otherwise start from 0
    const startIndex = options.currentToolCallIndex ?? 0;
    const toolProcessingResult = await processToolCalls(startIndex);

    if (toolProcessingResult.status !== IntentResultStatus.SUCCESS) {
      logger.log('Stopping or pausing processing because tool processing result is not success', {
        status: toolProcessingResult.status,
      });
      return toolProcessingResult;
    }

    if (manualToolCall) {
      logger.log('Stopping processing because manual tool call is present', { manualToolCall });
      return toolProcessingResult;
    }

    const nextRemainingSteps = remainingSteps - 1;

    // Check if to-do list has incomplete steps (for UDC "generate" steps that don't use tools)
    const hasTodoIncomplete = await this.hasTodoListIncompleteSteps(title);

    // classifiedTasks = this.classifyTasksFromActiveTools(activeTools);

    if (
      (toolCalls.length > 0 || hasTodoIncomplete) &&
      nextRemainingSteps > 0 &&
      !this.stopProcessingForClassifiedTask(classifiedTasks, toolCalls)
    ) {
      // Update indicator to show we're still working
      const firstToolName = toolCalls.length > 0 ? (toolCalls[0].toolName as ToolName) : undefined;
      await this.renderIndicator(title, lang, firstToolName);

      // Check if TODO_LIST_UPDATE was called and get next step intent for UDC
      const wasTodoListUpdateCalled = toolCalls.some(
        call => !call.dynamic && call.toolName === ToolName.TODO_LIST_UPDATE
      );
      const nextStepIntent = wasTodoListUpdateCalled
        ? await this.getNextTodoListStepIntent(title, intent)
        : null;

      // Continue the current invocation count so the user'query is not included in the next iteration
      params.invocationCount = (params.invocationCount ?? 0) + 1;
      params.intent = nextStepIntent || intent;

      return this.handle(params, {
        remainingSteps: nextRemainingSteps,
      });
    }

    if (nextRemainingSteps === 0) {
      const confirmationMessage = t('common.stepLimitReached');

      await this.renderer.updateConversationNote({
        path: title,
        newContent: confirmationMessage,
        lang,
        handlerId,
        includeHistory: false,
      });

      return {
        status: IntentResultStatus.NEEDS_CONFIRMATION,
        confirmationMessage,
        onConfirmation: async (_message: string) => {
          // Reset nextRemainingSteps to MAX_STEP_COUNT and continue processing
          // Continue the current invocation count so the user'query is not included in the next iteration
          params.invocationCount = (params.invocationCount ?? 0) + 1;

          return this.handle(params, {
            remainingSteps: MAX_STEP_COUNT,
          });
        },
        onRejection: async (_rejectionMessage: string) => {
          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
      };
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

    return toolProcessingResult;
  }

  /**
   * @inheritdoc
   */
  public async serializeInvocation<T>(params: {
    title: string;
    handlerId: string;
    command: string;
    toolCall: ToolCallPart<T>;
    result: ToolResultPart['output'];
    step?: number;
  }): Promise<void> {
    await this.renderer.serializeToolInvocation({
      path: params.title,
      command: params.command,
      handlerId: params.handlerId,
      step: params.step,
      toolInvocations: [
        {
          ...params.toolCall,
          type: 'tool-result',
          output: params.result,
        },
      ],
    });
  }

  /**
   * Stop processing for specific classified tasks
   * @param classifiedTasks
   */
  private stopProcessingForClassifiedTask(
    classifiedTasks: string[],
    toolCalls: ToolCalls
  ): boolean {
    if (classifiedTasks.length !== 1) return false;

    const task = classifiedTasks[0];

    if (!SINGLE_TURN_TASKS.has(task)) return false;

    // Check if any of the current tool calls belong to the classified task
    const taskTools = TASK_TO_TOOLS_MAP[task];
    if (!taskTools) return false;

    const hasTaskTool = toolCalls.some(toolCall => {
      if (toolCall.dynamic) return false;
      return taskTools.has(toolCall.toolName as ToolName);
    });

    // Only stop if the task is single-turn AND the current tool calls belong to that task
    return hasTaskTool;
  }

  /**
   * Generate to-do list prompt from frontmatter state
   * @param title The conversation title
   * @returns The formatted to-do list prompt or empty string
   */
  private async generateTodoListPrompt(title: string): Promise<string> {
    // Get to-do list state from frontmatter
    const todoListState = await this.renderer.getConversationProperty<handlers.TodoListState>(
      title,
      'todo_list'
    );

    // Format to-do list state for system prompt
    if (!todoListState || !todoListState.steps || todoListState.steps.length === 0) {
      return '';
    }

    return `\n\nTO-DO LIST:
You are working on a to-do list with ${todoListState.steps.length} step(s).
Current step: ${todoListState.currentStep} of ${todoListState.steps.length}

Steps:
${todoListState.steps
  .map((step, index) => {
    const status =
      step.status === 'completed'
        ? '✅ Completed'
        : step.status === 'skipped'
          ? '⏭️ Skipped'
          : step.status === 'in_progress'
            ? '🔄 In Progress'
            : '⏳ Pending';
    return `${index + 1}. ${status}: ${step.task}`;
  })
  .join('\n')}

When you complete or skip the current step, use the ${ToolName.TODO_LIST_UPDATE} tool with:
- status: in_progress, skipped, or completed
- nextStep: (optional) the step number to move to after updating`;
  }

  /**
   * Generate the skill catalog prompt showing available skills.
   * @returns The formatted skill catalog section or empty string
   */
  private generateSkillCatalogPrompt(): string {
    const catalog = this.plugin.skillService.getSkillCatalog();

    if (catalog.length === 0) {
      return '';
    }

    const entries = catalog.map(entry => `- ${entry.name}: ${entry.description}`).join('\n');

    return `\n\nAVAILABLE SKILLS:
${entries}

Use the ${ToolName.USE_SKILLS} tool to activate skills when you need domain-specific knowledge for the task.`;
  }

  /**
   * Generate individual system prompts for each active skill.
   * Each skill gets its own entry to keep content cleanly separated.
   * @param activeSkillNames Array of active skill names from frontmatter
   * @returns Array of formatted skill prompts, one per skill
   */
  private generateActiveSkillPrompts(activeSkillNames: string[]): string[] {
    if (activeSkillNames.length === 0) {
      return [];
    }

    const { contents } = this.plugin.skillService.getSkillContents(activeSkillNames);

    return Object.entries(contents).map(([name, content]) => `ACTIVE SKILL: ${name}\n${content}`);
  }

  /**
   * Classify tasks from query using classifier
   */
  private async classifyTasksFromQuery(
    query: string,
    upstreamOptions?: AgentHandlerParams['upstreamOptions']
  ): Promise<{ tasks: string[]; matchType?: 'static' | 'prefixed' | 'clustered' }> {
    // Check if classification should be ignored (only when explicitly set, not when embedding is disabled)
    if (upstreamOptions?.ignoreClassify) {
      return { tasks: [] };
    }

    const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
    const classifier = getClassifier(embeddingSettings, upstreamOptions?.isReloadRequest ?? false);
    const result = await classifier.doClassify(query);

    if (!result) {
      return { tasks: [] };
    }

    const { name: clusterName, matchType } = result;
    logger.log(`The user input was classified as "${clusterName}" (matchType: ${matchType})`);
    // Split cluster name by ':' to get tasks (e.g., "vault:revert" -> ["vault", "revert"])
    const tasks = clusterName.split(':').filter(task => task.length > 0);

    return { tasks, matchType };
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

  /**
   * Get the next step intent for TodoList if TODO_LIST_UPDATE was called
   * Returns null if not a UDC or no next step available
   * Skips over completed or skipped steps to find the next pending or in_progress step
   */
  private async getNextTodoListStepIntent(
    title: string,
    currentIntent: Intent
  ): Promise<Intent | null> {
    const udcCommand = await this.renderer.getConversationProperty<string>(title, 'udc_command');
    if (!udcCommand) {
      return null;
    }

    const updatedTodoList = await this.renderer.getConversationProperty<handlers.TodoListState>(
      title,
      'todo_list'
    );

    if (!updatedTodoList || updatedTodoList.steps.length === 0) {
      return null;
    }

    // Find the next step that is not completed or skipped
    // Start from currentStep (1-based) and look for the next pending or in_progress step
    // Convert 1-based step number to 0-based index for array access
    let stepIndex = updatedTodoList.currentStep - 1;

    // Skip over any completed or skipped steps
    while (
      stepIndex < updatedTodoList.steps.length &&
      (updatedTodoList.steps[stepIndex]?.status === 'completed' ||
        updatedTodoList.steps[stepIndex]?.status === 'skipped')
    ) {
      stepIndex++;
    }

    const nextStep = updatedTodoList.steps[stepIndex];
    if (!nextStep) {
      return null;
    }

    if (updatedTodoList.createdBy === 'ai') {
      // Only tasks are different between steps for AI
      return {
        ...currentIntent,
        query: nextStep.task,
      };
    }

    // createdBy: udc
    // Create new intent with only the next step's metadata
    // Do NOT inherit step-specific fields (model, systemPrompts, no_confirm) from current step
    return {
      query: nextStep.task,
      type: nextStep.type ?? '',
      model: nextStep.model,
      systemPrompts: nextStep.systemPrompts,
      no_confirm: nextStep.no_confirm,
    };
  }

  /**
   * Find the task name for a given tool name
   */
  private getTaskForTool(toolName: ToolName): string | null {
    for (const [task, taskTools] of Object.entries(TASK_TO_TOOLS_MAP)) {
      if (taskTools.has(toolName)) {
        return task;
      }
    }
    return null;
  }

  /**
   * Check if the to-do list has incomplete steps (pending or in_progress)
   * @param title The conversation title
   * @returns True if there are incomplete steps
   */
  private async hasTodoListIncompleteSteps(title: string): Promise<boolean> {
    const todoListState = await this.renderer.getConversationProperty<handlers.TodoListState>(
      title,
      'todo_list'
    );

    if (!todoListState || !todoListState.steps || todoListState.steps.length === 0) {
      return false;
    }

    // Check if any step is not completed and not skipped
    return todoListState.steps.some(
      step => step.status !== 'completed' && step.status !== 'skipped'
    );
  }
}

// Apply mixins to merge classes into SuperAgent class
applyMixins(SuperAgent, [SuperAgentHandlers]);
