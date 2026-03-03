import { ModelMessage, streamText } from 'ai';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { createLLMStream } from 'src/utils/textStreamer';
import { SysError } from 'src/utils/errors';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { ToolRegistry, ToolName } from '../ToolRegistry';
import type { AgentHandlerParams } from '../types';
import { SuperAgentSystemPromptBuilder } from './SystemPromptBuilder';
import type { ToolContentStreamInfo } from './SuperAgent/SuperAgentToolContentStream';
import type { TodoListState } from './handlers/TodoList';

export interface StreamTextExecutorAgentContext {
  plugin: StewardPlugin;
  renderer: ConversationRenderer;
  renderIndicator(title: string, lang?: string | null, toolName?: ToolName): Promise<void>;
  createToolContentExtractor(toolName: string): { feed: (delta: string) => string };
  consumeToolContentStream(params: {
    title: string;
    toolContentStream: AsyncGenerator<{
      toolCallId: string;
      toolName: string;
      contentDelta: string;
    }>;
    handlerId?: string;
    lang?: string | null;
  }): Promise<ToolContentStreamInfo | undefined>;
}

function asStreamTextExecutorAgent(
  instance: AgentStreamTextExecutor
): StreamTextExecutorAgentContext {
  return instance as unknown as StreamTextExecutorAgentContext;
}

export class AgentStreamTextExecutor {
  protected async executeStreamText<TToolCalls = unknown>(
    params: AgentHandlerParams & {
      activeTools: ToolName[];
      activeSkills: string[];
      tools: NonNullable<Parameters<typeof streamText>[0]['tools']> & { [s: string]: unknown };
      toolsThatEnableConclude: Set<ToolName>;
    }
  ): Promise<{
    toolCalls: TToolCalls;
    conversationHistory: ModelMessage[];
    toolContentStreamInfo?: ToolContentStreamInfo;
  }> {
    const agent = asStreamTextExecutorAgent(this);
    let timer: number | null = null;

    try {
      const conversationHistory = await agent.renderer.extractConversationHistory(params.title);

      const compactionResult = await agent.plugin.compactionOrchestrator.run({
        conversationTitle: params.title,
        visibleWindowSize: 10,
        lang: params.lang,
      });

      const llmConfig = await agent.plugin.llmService.getLLMConfig({
        overrideModel: params.intent.model,
        generateType: 'text',
      });

      const shouldUseTools = params.intent.use_tool !== false;
      const hasConcludeEligibleTool = params.activeTools.some(t =>
        params.toolsThatEnableConclude.has(t)
      );
      const hasCompactionContext = !!compactionResult.systemMessage;
      const activeToolNames = shouldUseTools
        ? [
            ...params.activeTools,
            ToolName.ACTIVATE,
            ...(hasConcludeEligibleTool ? [ToolName.CONCLUDE] : []),
            ...(hasCompactionContext ? [ToolName.RECALL_COMPACTED_CONTEXT] : []),
          ]
        : [ToolName.SWITCH_AGENT_CAPACITY];

      const registry = ToolRegistry.buildFromTools(params.tools)
        .setActive(activeToolNames)
        .setAdditionalGuidelines(agent.plugin.guardrailsRuleService.getInstructionsByTool());

      if (params.intent.no_confirm) {
        registry.exclude([ToolName.CONFIRMATION, ToolName.ASK_USER]);
      }

      const messages = [...conversationHistory];
      if (!params.invocationCount) {
        messages.push({ role: 'user', content: params.intent.query });
      }

      agent.plugin.llmService.validateImageSupport(
        params.intent.model || agent.plugin.settings.llm.chat.model,
        messages,
        params.lang
      );

      const abortSignal = agent.plugin.abortService.createAbortController('super-agent');

      let rejectStreamError: (error: Error) => void;
      const streamErrorPromise = new Promise<never>((_, reject) => {
        rejectStreamError = reject;
      });

      const currentNote =
        (await agent.renderer.getConversationProperty<string>(params.title, 'current_note')) ??
        null;

      let currentPosition: number | null = null;
      if (currentNote) {
        const cursor = agent.plugin.editor.getCursor();
        currentPosition = cursor.line;
      }

      const todoListPrompt = activeToolNames.includes(ToolName.TODO_LIST_UPDATE)
        ? await this.generateTodoListPrompt(params.title)
        : '';
      const skillCatalogPrompt = this.generateSkillCatalogPrompt();
      const shouldUseCoreSystemPrompt = shouldUseTools;

      const resolvedSystemPrompts =
        params.intent.systemPrompts && params.intent.systemPrompts.length > 0
          ? await agent.plugin.userDefinedCommandService.processSystemPromptsWikilinks(
              params.intent.systemPrompts
            )
          : [];
      const additionalSystemPrompts = [...resolvedSystemPrompts];

      if (llmConfig.systemPrompt) {
        additionalSystemPrompts.push(llmConfig.systemPrompt);
      }

      const activeSkillPrompts = this.generateActiveSkillPrompts(params.activeSkills || []);
      additionalSystemPrompts.push(...activeSkillPrompts);

      if (compactionResult.systemMessage) {
        additionalSystemPrompts.push(compactionResult.systemMessage);
      }

      if (additionalSystemPrompts.length > 0) {
        for (const item of additionalSystemPrompts) {
          messages.unshift({ role: 'system', content: item });
        }
      }

      let detectedTool: ToolName | undefined;
      const systemPromptBuilder = new SuperAgentSystemPromptBuilder();
      const coreSystemPrompt = systemPromptBuilder.buildCorePrompt({
        registry,
        currentNote,
        currentPosition,
        todoListPrompt,
        skillCatalogPrompt,
      });
      const disabledToolModeSystemPrompt = systemPromptBuilder.buildDisabledToolsPrompt();

      type RepairToolCall = Parameters<typeof streamText>[0]['experimental_repairToolCall'];

      const { toolCalls: toolCallsPromise, fullStream } = streamText({
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        maxOutputTokens: llmConfig.maxOutputTokens,
        abortSignal,
        system: shouldUseCoreSystemPrompt ? coreSystemPrompt : disabledToolModeSystemPrompt,
        messages,
        tools: registry.getToolsObject() as NonNullable<Parameters<typeof streamText>[0]['tools']>,
        experimental_repairToolCall: llmConfig.repairToolCall as RepairToolCall,
        onError: ({ error }) => {
          logger.error('Error in streamText', error);
          rejectStreamError(error as Error);
        },
        onAbort: () => {
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

      const { textStream, textDone, toolContentStream } = createLLMStream(fullStream, {
        toolContentStreaming: {
          targetTools: new Set([ToolName.EDIT, ToolName.CREATE]),
          createExtractor: (toolName: string) => agent.createToolContentExtractor(toolName),
        },
      });

      const streamPromise = agent.renderer.streamConversationNote({
        path: params.title,
        stream: textStream,
        handlerId: params.handlerId,
        step: params.invocationCount,
      });

      await Promise.race([textDone, streamErrorPromise]);

      const toolContentStreamPromise = agent.consumeToolContentStream({
        title: params.title,
        toolContentStream,
        handlerId: params.handlerId,
        lang: params.lang,
      });

      timer = window.setTimeout(() => {
        agent.renderIndicator(params.title, params.lang, detectedTool);
      }, 1000);

      const toolCalls = (await Promise.race([toolCallsPromise, streamErrorPromise])) as TToolCalls;
      const toolContentStreamInfo = await toolContentStreamPromise;

      await streamPromise.catch(() => {
        // Ignore errors here, they're handled by streamErrorPromise
      });

      return {
        toolCalls,
        conversationHistory,
        toolContentStreamInfo,
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Generate to-do list prompt from frontmatter state.
   */
  protected async generateTodoListPrompt(title: string): Promise<string> {
    const agent = asStreamTextExecutorAgent(this);
    const todoListState = await agent.renderer.getConversationProperty<TodoListState>(
      title,
      'todo_list'
    );

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
   */
  protected generateSkillCatalogPrompt(): string {
    const agent = asStreamTextExecutorAgent(this);
    const catalog = agent.plugin.skillService.getSkillCatalog();

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
   */
  protected generateActiveSkillPrompts(activeSkillNames: string[]): string[] {
    if (activeSkillNames.length === 0) {
      return [];
    }

    const agent = asStreamTextExecutorAgent(this);
    const { contents } = agent.plugin.skillService.getSkillContents(activeSkillNames);

    return Object.entries(contents).map(([name, content]) => `ACTIVE SKILL: ${name}\n${content}`);
  }
}
