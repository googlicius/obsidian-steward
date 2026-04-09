import type { ModelMessage } from 'ai';
import { Agent } from '../../Agent';
import { AgentHandlerParams, AgentResult, IntentResultStatus, Intent } from '../../types';
import { ToolCallPart, ToolResultPart, TypedToolCallPart } from '../../tools/types';
import { getTranslation } from 'src/i18n';
import { ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { getClassifier } from 'src/lib/modelfusion';
import { logger } from 'src/utils/logger';
import * as components from '../components';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { applyMixins } from 'src/utils/applyMixins';
import * as handlers from '../handlers';
import { CommandSyntaxParser } from '../../command-syntax-parser';
import { createStepProcessedQuery } from './stepProcessedQuery';
import {
  type AgentToolsRecord,
  loadGoogleTools,
  loadSuperAgentToolsBase,
  SUPER_AGENT_TOOL_NAMES,
} from '../agentTools';
import type { AgentCorePromptContext } from '../../Agent';
import { isGoogleModel } from '../googleUtils';

const SUPER_AGENT_VALID_TOOL_NAMES: ReadonlySet<ToolName> = SUPER_AGENT_TOOL_NAMES;

/**
 * Map of classifier task label → tool names (used with `TASK_DEFAULT_ACTIVATE_TOOLS`).
 * Tool availability for a turn also comes from `ToolIntentResolution` (declared/allowed/active,
 * UDC `allowed_tools`, frontmatter `tools`, conclude / compaction), not a separate dependency graph.
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
    ToolName.EXISTS,
  ]),
  revert: new Set([ToolName.REVERT]),
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
const SINGLE_TURN_TASKS = new Set(['search']);

const toolsThatEnableConclude = new Set([
  ToolName.EDIT,
  ToolName.MOVE,
  ToolName.COPY,
  ToolName.DELETE,
  ToolName.RENAME,
  ToolName.CREATE,
  ToolName.UPDATE_FRONTMATTER,
]);

type ToolCalls = Array<TypedToolCallPart & { dynamic?: boolean }>;

export interface SuperAgent
  extends Agent,
    AgentHandlerContext,
    components.Handlers,
    components.ToolContentStreamConsumer,
    components.ManualToolCall,
    components.StreamTextExecutor,
    components.ToolCallExecutor {}

export class SuperAgent extends Agent implements AgentHandlerContext {
  public [components.TOOL_CONTENT_STREAM_CONSUMER_SYMBOL] = true as const;

  public getValidToolNames(): ReadonlySet<ToolName> {
    return SUPER_AGENT_VALID_TOOL_NAMES;
  }

  public buildCorePrompt(context?: AgentCorePromptContext): string {
    if (!context) {
      return 'You are a helpful assistant who helps users with their Obsidian vault.';
    }
    const taskSection = this.buildTaskInstructionsFromAvailableTools(context.availableTools);

    return `You are a helpful assistant who helps users with their Obsidian vault.

${taskSection}

YOU HAVE ACCESS TO THE FOLLOWING TOOLS:
${context.registry.generateToolsSection()}

OTHER TOOLS (Inactive, need activate before using them):
${context.registry.generateOtherToolsSection(
  'No other tools available.',
  new Set([ToolName.SEARCH_MORE, ToolName.CONCLUDE])
)}

TOOLS GUIDELINES:
${context.registry.generateGuidelinesSection()}
${context.currentNote ? `\nCURRENT NOTE: ${context.currentNote} (Cursor position: ${context.currentPosition})` : ''}${context.skillCatalogPrompt}

NOTE:
- DO NOT mention or explain the tools you use or activate to users. Only communicate the results or outcomes.
- Respect user's language or the language they specified. The lang property should be a valid language code: en, vi, etc.`;
  }

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
    const chatModel = intent.model ?? this.plugin.settings.llm.chat.model;
    const tools = await this.getSuperAgentTools(title, chatModel);

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

    // Highest priority: command syntax (c:tool --args) bypasses classification and LLM
    const commandSyntaxToolCalls = CommandSyntaxParser.parseAndConvert(intent.query);

    const manualToolCall = commandSyntaxToolCalls
      ? undefined
      : await this.manualToolCall({
          title,
          query: intent.query,
          activeTools,
          classifiedTasks,
          lang,
          classificationMatchType,
        });

    let toolCalls: ToolCalls;
    let conversationHistory: ModelMessage[] = [];
    let toolContentStreamInfo: components.ToolContentStreamInfo | undefined;

    if (options.toolCalls) {
      toolCalls = options.toolCalls;
    } else if (commandSyntaxToolCalls) {
      toolCalls = commandSyntaxToolCalls as ToolCalls;
    } else if (manualToolCall) {
      toolCalls = [manualToolCall] as ToolCalls;
    } else {
      const result = await this.executeStreamText<ToolCalls>({
        ...params,
        activeTools,
        tools,
        toolsThatEnableConclude,
      });
      toolCalls = result.toolCalls;
      conversationHistory = result.conversationHistory;
      toolContentStreamInfo = result.toolContentStreamInfo;
    }

    const toolProcessingResult = await this.executeToolCalls({
      agentId: 'super',
      title,
      lang,
      handlerId,
      agentParams: params,
      remainingSteps,
      toolCalls: toolCalls as unknown as Array<TypedToolCallPart & { dynamic?: boolean }>,
      startIndex: options.currentToolCallIndex ?? 0,
      activeTools,
      availableTools: tools,
      toolContentStreamInfo,
    });

    if (toolProcessingResult.status !== IntentResultStatus.SUCCESS) {
      logger.log('Stopping or pausing processing because tool processing result is not success', {
        status: toolProcessingResult.status,
        toolCalls,
        intent,
      });
      return toolProcessingResult;
    }

    // Stop if manual tool call, except todo_write (update) injected for client-processed steps
    const isManualTodoWriteUpdate =
      manualToolCall &&
      manualToolCall.toolName === ToolName.TODO_WRITE &&
      handlers.isTodoWriteUpdateToolInput(manualToolCall.input);
    if (manualToolCall && !isManualTodoWriteUpdate) {
      logger.log('Stopping processing because manual tool call is present', { manualToolCall });
      return toolProcessingResult;
    }

    const nextRemainingSteps = remainingSteps - 1;

    // Check if to-do list has incomplete steps (for UDC "generate" steps that don't use tools)
    const hasTodoIncomplete = await this.hasTodoListIncompleteSteps(title);

    if (
      (toolCalls.length > 0 || hasTodoIncomplete) &&
      nextRemainingSteps > 0 &&
      !this.stopProcessingForClassifiedTask(classifiedTasks, toolCalls)
    ) {
      const wasTodoWriteUpdateCalled = toolCalls.some(
        call =>
          !call.dynamic &&
          call.toolName === ToolName.TODO_WRITE &&
          handlers.isTodoWriteUpdateToolInput(call.input)
      );
      const nextStepIntent = wasTodoWriteUpdateCalled
        ? await this.getNextTodoListStepIntent(title, intent)
        : null;

      if (wasTodoWriteUpdateCalled && nextStepIntent === null) {
        return toolProcessingResult;
      }

      // Continue the current invocation count so the user'query is not included in the next iteration
      params.invocationCount = (params.invocationCount ?? 0) + 1;
      params.intent = nextStepIntent ?? {
        ...intent,
        query: createStepProcessedQuery(intent.query),
      };

      let injectedToolCall;

      if (
        classifiedTasks.length === 1 &&
        classifiedTasks[0] === 'generate' &&
        (await this.isLastTodoListStep(title))
      ) {
        injectedToolCall = await this.craftTodoWriteUpdateToolCallManually(title);
      }

      if (!injectedToolCall) {
        // Update indicator to show we're still working
        const firstToolName =
          toolCalls.length > 0 ? (toolCalls[0].toolName as ToolName) : undefined;
        await this.renderIndicator(title, lang, firstToolName);
      }

      return this.handle(params, {
        remainingSteps: nextRemainingSteps,
        ...(injectedToolCall && {
          toolCalls: [injectedToolCall] as ToolCalls,
        }),
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

  private async getSuperAgentTools(
    conversationTitle: string,
    modelId?: string
  ): Promise<AgentToolsRecord> {
    const baseTools = await loadSuperAgentToolsBase();
    const googleTools = modelId && isGoogleModel(modelId) ? await loadGoogleTools() : {};

    const mcp = await this.plugin.mcpService.getMcpToolsForConversation(conversationTitle);
    return {
      ...baseTools,
      ...googleTools,
      ...mcp.inactive,
      ...mcp.active,
    } as AgentToolsRecord;
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
    const classifier = await getClassifier(
      embeddingSettings,
      upstreamOptions?.isReloadRequest ?? false
    );
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
      const classifier = await getClassifier(
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
   * Get the next step intent for TodoList
   * Returns null if not a UDC or no next step available
   * Skips over completed or skipped steps to find the next pending or in_progress step
   * @param force When true, skip the current step regardless of its status to return the actual next step
   */
  private async getNextTodoListStepIntent(
    title: string,
    currentIntent: Intent
  ): Promise<Intent | null> {
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
    const udcCommand = await this.renderer.getConversationProperty<string>(title, 'udc_command');
    if (!udcCommand) {
      return null;
    }

    // Create new intent with only the next step's metadata
    // Do NOT inherit step-specific fields (model, no_confirm) from current step.
    // Tool allowlist is command-level: keep it on every step. Recursive handle() does not re-run
    // safeHandle/resolveIntentTools, so we must set tools here or fall back to frontmatter.
    let commandLevelTools = currentIntent.tools;
    if (!commandLevelTools || commandLevelTools.length === 0) {
      commandLevelTools = await this.renderer.getConversationProperty<ToolName[]>(
        title,
        'allowed_tools'
      );
    }

    // Root v2 system_prompt should persist across all UDC steps. We intentionally do NOT merge
    // per-step system_prompt here; step-level instructions are surfaced via todo_write tool results.
    let systemPrompts: string[] | undefined;
    const udc = this.plugin.userDefinedCommandService;
    const command = udc.userDefinedCommands.get(udcCommand);
    if (command?.getVersion() === 2) {
      const root = command.normalized.system_prompt;
      if (root && root.length > 0) {
        const rootLines = root.map(line => udc.replacePlaceholders(line));
        systemPrompts = await udc.processSystemPromptsWikilinks(rootLines);
      }
    }

    return {
      query: nextStep.task,
      type: nextStep.type ?? '',
      model: nextStep.model,
      no_confirm: nextStep.no_confirm,
      tools: commandLevelTools && commandLevelTools.length > 0 ? commandLevelTools : undefined,
      systemPrompts,
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
   * Check if the current step is the last step of the to-do list
   * @param title The conversation title
   * @returns True if the current step is the last step
   */
  private async isLastTodoListStep(title: string): Promise<boolean> {
    const todoListState = await this.renderer.getConversationProperty<handlers.TodoListState>(
      title,
      'todo_list'
    );

    if (!todoListState || !todoListState.steps || todoListState.steps.length === 0) {
      return false;
    }

    return todoListState.currentStep === todoListState.steps.length;
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
applyMixins(SuperAgent, [
  components.Handlers,
  components.ToolContentStreamConsumer,
  components.ManualToolCall,
  components.StreamTextExecutor,
  components.ToolCallExecutor,
]);
