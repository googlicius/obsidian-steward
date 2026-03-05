import { streamText } from 'ai';
import { Agent } from '../../Agent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart, ToolResultPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { getTranslation } from 'src/i18n';
import { applyMixins } from 'src/utils/applyMixins';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { AgentHandlers } from '../AgentHandlers';
import { AgentToolCallExecutor } from '../AgentToolCallExecutor';
import { AgentGenerateTextExecutor } from '../AgentGenerateTextExecutor';
import { SUBAGENT_TOOLS } from '../agentTools';

const tools = SUBAGENT_TOOLS;

type ToolCalls = Awaited<Awaited<ReturnType<typeof streamText<typeof tools>>>['toolCalls']>;

export interface SubAgent
  extends Agent,
    AgentHandlerContext,
    AgentHandlers,
    AgentToolCallExecutor,
    AgentGenerateTextExecutor {}

export class SubAgent extends Agent implements AgentHandlerContext {
  private static readonly CORE_SYSTEM_PROMPT = `You are a subagent worker in Obsidian Steward.

Your role:
- Execute only the delegated job from the parent agent.
- Prefer tool-based execution when tools are available.
- Keep responses concise and task-focused.

Rules:
- Do not change scope beyond the delegated job.
- Do not ask unrelated follow-up questions.`;

  public async renderIndicator(
    title: string,
    lang?: string | null,
    _toolName?: ToolName
  ): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.working'));
  }

  public async handle(
    params: AgentHandlerParams,
    options: {
      remainingSteps?: number;
      toolCalls?: ToolCalls;
      currentToolCallIndex?: number;
    } = {}
  ): Promise<AgentResult> {
    const handlerId = params.handlerId ?? uniqueID();
    const remainingSteps = options.remainingSteps ?? 12;

    if (remainingSteps <= 0) {
      return { status: IntentResultStatus.SUCCESS };
    }

    const activeTools = await this.loadActiveTools(params.title, params.activeTools);
    const inactiveTools = params.inactiveTools || [];
    const activeSkills = await this.loadActiveSkills(params.title);

    if (!params.invocationCount) {
      await this.renderer.addUserMessage({
        path: params.title,
        newContent: params.intent.query,
        step: params.invocationCount,
        contentFormat: 'hidden',
      });
    }

    let toolCalls: ToolCalls;
    if (options.toolCalls) {
      toolCalls = options.toolCalls;
    } else {
      const streamResult = await this.executeGenerateText<ToolCalls>({
        ...params,
        activeTools,
        inactiveTools,
        activeSkills,
        tools,
        coreSystemPrompt: SubAgent.CORE_SYSTEM_PROMPT,
      });
      toolCalls = streamResult.toolCalls;
    }

    const toolProcessingResult = await this.executeToolCalls({
      agentId: 'subagent',
      title: params.title,
      lang: params.lang,
      handlerId,
      agentParams: params,
      remainingSteps,
      toolCalls: toolCalls as unknown as Array<
        ToolCallPart<Record<string, unknown>> & { dynamic?: boolean }
      >,
      startIndex: options.currentToolCallIndex ?? 0,
      activeTools,
      activeSkills,
      availableTools: tools,
    });

    if (toolProcessingResult.status !== IntentResultStatus.SUCCESS) {
      return toolProcessingResult;
    }

    const nextRemainingSteps = remainingSteps - 1;
    if (toolCalls.length === 0 || nextRemainingSteps <= 0) {
      return toolProcessingResult;
    }

    await this.renderIndicator(params.title);

    params.invocationCount = (params.invocationCount ?? 0) + 1;
    return this.handle(params, {
      remainingSteps: nextRemainingSteps,
    });
  }

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
}

applyMixins(SubAgent, [AgentHandlers, AgentToolCallExecutor, AgentGenerateTextExecutor]);
