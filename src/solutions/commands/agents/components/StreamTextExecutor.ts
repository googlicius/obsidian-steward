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
import type { LanguageModelUsage, ModelMessage, streamText } from 'ai';
import { AbortOperationKeys } from 'src/constants';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events } from 'src/types/events';

type AiStreamTextParams = Parameters<typeof streamText>[0];

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional mixin pattern
export interface StreamTextExecutor extends ToolIntentResolution, SystemPromptComposer {}

function asAgent(instance: StreamTextExecutor) {
  if (!isToolContentStreamConsumer(instance)) {
    throw new Error(
      'Agent must implement ToolContentStreamConsumer interface to use executeStreamText'
    );
  }
  return instance as unknown as Agent & ToolContentStreamConsumer;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional mixin pattern
export class StreamTextExecutor {
  protected async executeStreamText<TToolCalls = unknown>(
    params: AgentHandlerParams & {
      activeTools: ToolName[];
      tools: NonNullable<AiStreamTextParams['tools']> & { [s: string]: unknown };
    }
  ): Promise<{
    toolCalls: TToolCalls;
    conversationHistory: ModelMessage[];
    text: string;
    toolContentStreamInfo?: ToolContentStreamInfo;
    usage?: LanguageModelUsage;
    totalUsage?: LanguageModelUsage;
  }> {
    const agent = asAgent(this);

    const modelForStream = params.intent.model?.trim() || agent.plugin.settings.llm.chat.model;

    const { modelChanged } = await agent.plugin.compactionTokenService.compactOnModelChangeIfNeeded(
      {
        conversationTitle: params.title,
        model: modelForStream,
        lang: params.lang,
      }
    );

    const historyResult = await agent.plugin.conversationRenderer.extractConversationHistory(
      params.title,
      {
        maxMessages: params.intent.maxHistoryMessages ?? null,
        model: modelForStream,
        forceReduceBeforeAdvance: modelChanged,
      }
    );

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

    const effectiveAllowedNames = this.buildSuperAgentEffectiveAllowedNames({
      declaredNormalized,
      expandedDeclared,
      conversationActiveTools: params.activeTools,
      allToolKeys: allSuperAgentKeys,
      hasCompactionContext: historyResult.hasCompactionContext,
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
      hasCompactionContext: historyResult.hasCompactionContext,
    });
    const allActiveToolNames = [...activeToolNames, ...Object.keys(mcpTools.active)];
    const activeToolSet = new Set(allActiveToolNames);
    const toolsForRegistry = {
      ...filteredTools,
      ...mcpTools.active,
      ...mcpTools.inactive,
    };

    const registry = ToolRegistry.buildFromTools(toolsForRegistry)
      .setActive(allActiveToolNames)
      .setSupplementalGuidelines({
        guardrails: agent.plugin.guardrailsRuleService.getInstructionsByTool(),
        memory: agent.plugin.toolInstructionService.getInstructionsByTool(),
      });

    if (params.intent.no_confirm) {
      registry.exclude([ToolName.CONFIRMATION, ToolName.ASK_USER_PREFERENCE]);
    }

    const messages = [...historyResult.messages];
    if (!params.invocationCount) {
      messages.push({ role: 'user', content: params.intent.query });
    }

    if (agent.plugin.abortService.isStopRequested(params.title)) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    const abortSignal = agent.plugin.abortService.createAbortController(
      params.title,
      AbortOperationKeys.SUPER_AGENT
    );

    try {
      let rejectStreamError: (error: Error) => void;
      let resolveSettleStream: (toolCalls: TToolCalls) => void;
      const settleStreamPromise = new Promise<TToolCalls>((resolve, reject) => {
        resolveSettleStream = resolve;
        rejectStreamError = reject;
      });

      let hasStreamSettled = false;

      const currentNote =
        (await agent.renderer.getConversationProperty<string>(params.title, 'current_note')) ??
        null;

      let currentPosition: number | null = null;
      if (currentNote) {
        const cursor = agent.plugin.editor.getCursor();
        currentPosition = cursor.line;
      }

      const includeSkillCatalog =
        !params.intent.tools ||
        params.intent.tools.length === 0 ||
        params.intent.tools.includes(ToolName.CONTENT_READING);
      const includeSubAgentCatalog =
        !params.intent.tools ||
        params.intent.tools.length === 0 ||
        params.intent.tools.includes(ToolName.CONTENT_READING);
      const runCommandAvailable = allActiveToolNames.includes(ToolName.RUN_COMMAND);

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

      if (additionalSystemPrompts.length > 0) {
        for (const item of additionalSystemPrompts) {
          messages.unshift({ role: 'system', content: item });
        }
      }

      const coreSystemPrompt =
        params.intent.coreSystemPrompt ??
        agent.buildCorePrompt({
          registry,
          availableTools: declaredNormalized ?? allSuperAgentKeys,
          currentNote,
          currentPosition,
          includeSkillCatalog,
          includeSubAgentCatalog,
          runCommandAvailable,
          extraCorePromptSections: params.intent.extraCorePromptSections,
        });

      type RepairToolCall = AiStreamTextParams['experimental_repairToolCall'];

      const { streamText, NoSuchToolError } = await getBundledLib('ai');

      const streamTextResult = streamText({
        model: llmConfig.model,
        ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
        maxOutputTokens: llmConfig.maxOutputTokens,
        abortSignal,
        system: coreSystemPrompt,
        messages,
        ...(llmConfig.reasoningCallExtras?.providerOptions
          ? { providerOptions: llmConfig.reasoningCallExtras.providerOptions }
          : {}),
        tools: registry.getToolsObject() as NonNullable<AiStreamTextParams['tools']>,
        experimental_repairToolCall: llmConfig.repairToolCall as RepairToolCall,
        onError: ({ error }) => {
          if (hasStreamSettled) {
            return;
          }
          logger.error('Error in streamText', error);
          rejectStreamError(error as Error);
        },
        onAbort: () => {
          if (hasStreamSettled) {
            return;
          }
          rejectStreamError(new DOMException('Request aborted', 'AbortError'));
        },
        onChunk: ({ chunk }) => {
          if (chunk.type === 'tool-input-start') {
            void agent.renderIndicator?.(params.title, params.lang, chunk.toolName as ToolName);

            const isNoSuchTool = !activeToolSet.has(chunk.toolName);
            if (isNoSuchTool && !hasStreamSettled) {
              const availableTools = Object.keys(registry.getToolsObject());
              logger.warn(
                `Aborting stream early: inactive dynamic tool call detected for ${chunk.toolName}.`
              );
              hasStreamSettled = true;
              resolveSettleStream([
                {
                  type: 'tool-call',
                  toolCallId: chunk.id,
                  toolName: chunk.toolName,
                  input: {},
                  dynamic: true,
                  invalid: true,
                  error: new NoSuchToolError({
                    toolName: chunk.toolName,
                    availableTools,
                  }),
                },
              ] as TToolCalls);

              agent.plugin.abortService.abortOperation(
                params.title,
                AbortOperationKeys.SUPER_AGENT
              );
            }
          }
        },
        onFinish: ({ finishReason }) => {
          if (hasStreamSettled) {
            return;
          }
          if (finishReason === 'length') {
            rejectStreamError(new SysError('Stream finished due to length limit'));
          } else if (finishReason === 'error') {
            rejectStreamError(new SysError('Stream finished due to error'));
          }
        },
      });

      const { textStream, textDone, toolContentStream } = createLLMStream(
        streamTextResult.fullStream,
        {
          toolContentStreaming: {
            targetTools: new Set([ToolName.EDIT, ToolName.CREATE]),
            createExtractor: (toolName: string) => agent.createToolContentExtractor(toolName),
          },
          abortSignal,
        }
      );

      const streamPromise = agent.renderer.streamConversationNote({
        path: params.title,
        stream: textStream,
        handlerId: params.handlerId,
        step: params.invocationCount,
        abortSignal,
      });

      await Promise.race([textDone, settleStreamPromise]);

      const toolContentStreamPromise = agent.consumeToolContentStream({
        title: params.title,
        toolContentStream,
        handlerId: params.handlerId,
        lang: params.lang,
        abortSignal,
      });

      const toolCalls = (await Promise.race([
        streamTextResult.toolCalls,
        settleStreamPromise,
      ])) as TToolCalls;
      const toolContentStreamInfo = await toolContentStreamPromise;

      await streamPromise.catch(() => {
        // Ignore errors here, they're handled by settleStreamPromise
      });

      let usage: LanguageModelUsage | undefined;
      let totalUsage: LanguageModelUsage | undefined;
      let text = '';

      if (!hasStreamSettled) {
        usage = await streamTextResult.usage;
        totalUsage = await streamTextResult.totalUsage;
        text = await streamTextResult.text;
      }

      eventEmitter.emit(Events.EXECUTED_STREAM_TEXT, {
        conversationTitle: params.title,
        lang: params.lang,
        model: modelForStream,
        promptTokens: usage?.inputTokens,
      });

      return {
        toolCalls,
        conversationHistory: historyResult.messages,
        text,
        toolContentStreamInfo,
        usage,
        totalUsage,
      };
    } finally {
      agent.plugin.abortService.unregisterOperation(params.title, AbortOperationKeys.SUPER_AGENT);
    }
  }
}

applyMixins(StreamTextExecutor, [ToolIntentResolution, SystemPromptComposer]);
