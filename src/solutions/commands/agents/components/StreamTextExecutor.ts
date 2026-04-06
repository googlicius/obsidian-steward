import { logger } from 'src/utils/logger';
import { createLLMStream } from 'src/utils/textStreamer';
import { SysError } from 'src/utils/errors';
import { ToolRegistry, ToolName } from '../../ToolRegistry';
import type { AgentHandlerParams } from '../../types';
import { applyMixins } from 'src/utils/applyMixins';
import { ToolIntentResolution } from './ToolIntentResolution';
import { SystemPromptComposer } from './SystemPromptComposer';
import {
  type ToolContentStreamInfo,
  isToolContentStreamConsumer,
  ToolContentStreamConsumer,
} from './ToolContentStreamConsumer';
import { Agent } from '../../Agent';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { ModelMessage, streamText } from 'ai';

type AiStreamTextParams = Parameters<typeof streamText>[0];

// eslint-disable-next-line @typescript-eslint/no-empty-interface -- declaration merge: adds mixin types to class instance
export interface StreamTextExecutor extends ToolIntentResolution, SystemPromptComposer {}

function asAgent(instance: StreamTextExecutor) {
  if (!isToolContentStreamConsumer(instance)) {
    throw new Error(
      'Agent must implement ToolContentStreamConsumer interface to use executeStreamText'
    );
  }
  return instance as unknown as Agent & ToolContentStreamConsumer;
}

export class StreamTextExecutor {
  protected async executeStreamText<TToolCalls = unknown>(
    params: AgentHandlerParams & {
      activeTools: ToolName[];
      tools: NonNullable<AiStreamTextParams['tools']> & { [s: string]: unknown };
      toolsThatEnableConclude: Set<ToolName>;
    }
  ): Promise<{
    toolCalls: TToolCalls;
    conversationHistory: ModelMessage[];
    toolContentStreamInfo?: ToolContentStreamInfo;
  }> {
    const agent = asAgent(this);

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

    const allSuperAgentKeys = [...agent.getValidToolNames()] as ToolName[];
    const declaredNormalized = this.normalizeDeclaredTools(
      params.intent.tools,
      agent.getValidToolNames()
    );
    const expandedDeclared =
      declaredNormalized === null ? [] : this.expandSuperAgentDeclaredTools(declaredNormalized);

    const hasCompactionContext = !!compactionResult.systemMessage;
    const hasConcludeEligibleDeclared =
      declaredNormalized !== null &&
      expandedDeclared.some(t => params.toolsThatEnableConclude.has(t));

    const effectiveAllowedNames = this.buildSuperAgentEffectiveAllowedNames({
      declaredNormalized,
      expandedDeclared,
      conversationActiveTools: params.activeTools,
      allToolKeys: allSuperAgentKeys,
      toolsThatEnableConclude: params.toolsThatEnableConclude,
      hasConcludeEligibleDeclaredTool: hasConcludeEligibleDeclared,
      hasCompactionContext,
    });
    const effectiveAllowed = new Set(effectiveAllowedNames);

    const filteredTools = this.filterToolsObject(
      params.tools,
      effectiveAllowed
    ) as typeof params.tools;
    const mcpTools = await agent.plugin.mcpService.getMcpToolsForConversation(params.title);

    const activeToolNames = this.resolveStreamActiveToolNames({
      declaredNormalized,
      expandedDeclared,
      effectiveAllowed,
      conversationActiveTools: params.activeTools,
      toolsThatEnableConclude: params.toolsThatEnableConclude,
      hasCompactionContext,
    });
    const allActiveToolNames = [...activeToolNames, ...Object.keys(mcpTools.active)];
    const toolsForRegistry = {
      ...filteredTools,
      ...mcpTools.active,
      ...mcpTools.inactive,
    };

    const registry = ToolRegistry.buildFromTools(toolsForRegistry)
      .setActive(allActiveToolNames)
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
      (await agent.renderer.getConversationProperty<string>(params.title, 'current_note')) ?? null;

    let currentPosition: number | null = null;
    if (currentNote) {
      const cursor = agent.plugin.editor.getCursor();
      currentPosition = cursor.line;
    }

    const todoListPrompt = activeToolNames.includes(ToolName.TODO_LIST_UPDATE)
      ? await this.generateTodoListPrompt({
          renderer: agent.renderer,
          title: params.title,
        })
      : '';
    const includeSkillCatalog =
      !params.intent.tools ||
      params.intent.tools.length === 0 ||
      params.intent.tools.includes(ToolName.CONTENT_READING);
    const skillCatalogPrompt = includeSkillCatalog
      ? this.generateSkillCatalogPrompt({
          plugin: agent.plugin,
        })
      : '';

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

    if (compactionResult.systemMessage) {
      additionalSystemPrompts.push(compactionResult.systemMessage);
    }

    if (additionalSystemPrompts.length > 0) {
      for (const item of additionalSystemPrompts) {
        messages.unshift({ role: 'system', content: item });
      }
    }

    const coreSystemPrompt = agent.buildCorePrompt({
      registry,
      availableTools: declaredNormalized ?? allSuperAgentKeys,
      currentNote,
      currentPosition,
      todoListPrompt,
      skillCatalogPrompt,
    });

    type RepairToolCall = AiStreamTextParams['experimental_repairToolCall'];

    const { streamText } = await getBundledLib('ai');

    const { toolCalls: toolCallsPromise, fullStream } = streamText({
      model: llmConfig.model,
      temperature: llmConfig.temperature,
      maxOutputTokens: llmConfig.maxOutputTokens,
      abortSignal,
      system: coreSystemPrompt,
      messages,
      tools: registry.getToolsObject() as NonNullable<AiStreamTextParams['tools']>,
      experimental_repairToolCall: llmConfig.repairToolCall as RepairToolCall,
      onError: ({ error }) => {
        logger.error('Error in streamText', error);
        rejectStreamError(error as Error);
      },
      onAbort: () => {
        rejectStreamError(new DOMException('Request aborted', 'AbortError'));
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === 'tool-input-start') {
          agent.renderIndicator?.(params.title, params.lang, chunk.toolName as ToolName);
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
  }
}

applyMixins(StreamTextExecutor, [ToolIntentResolution, SystemPromptComposer]);
