import { logger } from 'src/utils/logger';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { DynamicToolCall, Tool } from 'ai';
import { createGuardrailsMiddleware } from 'src/services/GuardrailsRuleService/guardrailsMiddleware';
import { createToolHandlerChain } from '../middleware/createToolHandlerChain';
import type { AgentHandlerParams, AgentResult } from '../../types';
import { IntentResultStatus } from '../../types';
import type { TypedToolCallPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import type { ToolContentStreamInfo } from './ToolContentStreamConsumer';
import type { Handlers } from './Handlers';
import * as handlers from '../handlers';
import { ToolHandlerMiddlewareContext } from '../middleware/types';
import { type Agent } from '../../Agent';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { HandlerInvocationContext } from '../HandlerInvocationContext';

function asAgent(instance: ToolCallExecutor) {
  return instance as unknown as Agent & Handlers;
}

export class ToolCallExecutor {
  protected async executeToolCalls(params: {
    agentId: string;
    title: string;
    lang?: string | null;
    handlerId: string;
    agentParams: AgentHandlerParams;
    remainingSteps: number;
    toolCalls: Array<TypedToolCallPart & { dynamic?: boolean }>;
    startIndex: number;
    activeTools: ToolName[];
    availableTools: { [x: string]: Tool };
    toolContentStreamInfo?: ToolContentStreamInfo;
  }): Promise<AgentResult> {
    const agent = asAgent(this);
    const handlerMap = agent.getToolHandlerMap();
    const { NoSuchToolError } = await getBundledLib('ai');

    const invocationCtx = new HandlerInvocationContext({
      title: params.title,
      handlerId: params.handlerId,
      step: params.agentParams.invocationCount ?? 0,
      lang: params.agentParams.lang,
      intent: params.agentParams.intent,
      agent: agent as unknown as AgentHandlerContext,
      agentHandlerParams: params.agentParams,
    });

    for (let index = params.startIndex; index < params.toolCalls.length; index += 1) {
      const toolCall = params.toolCalls[index];
      let toolCallResult: AgentResult | undefined;
      const continueProcessingFromNextTool = async (): Promise<AgentResult> => {
        params.agentParams.invocationCount = (params.agentParams.invocationCount ?? 0) + 1;
        invocationCtx.incrementStep();
        return agent.handle(params.agentParams, {
          remainingSteps: params.remainingSteps,
          toolCalls: params.toolCalls,
          currentToolCallIndex: index + 1,
        });
      };

      const dynamicToolCall = toolCall as unknown as DynamicToolCall;
      if (toolCall.dynamic && dynamicToolCall.error) {
        const prevToolCall = index > 0 ? params.toolCalls[index - 1] : undefined;
        const isNoSuchToolAfterActivate =
          prevToolCall &&
          !prevToolCall.dynamic &&
          prevToolCall.toolName === ToolName.ACTIVATE &&
          dynamicToolCall.error instanceof NoSuchToolError;

        // Start a new LLM turn if previous is activate_tools
        if (isNoSuchToolAfterActivate) {
          logger.warn(
            `Start a new LLM turn as the previous tool call is activate_tools, and the ${toolCall.toolName} isn't active yet.`
          );
          params.agentParams.invocationCount = (params.agentParams.invocationCount ?? 0) + 1;
          invocationCtx.incrementStep();
          return agent.handle(params.agentParams, {
            remainingSteps: params.remainingSteps,
          });
        }

        await agent.dynamic.handle(invocationCtx, {
          toolCall: dynamicToolCall,
          tools: params.availableTools,
        });
        continue;
      }

      if ('lang' in toolCall.input) {
        await agent.plugin.conversationRenderer.updateConversationFrontmatter(params.title, [
          {
            name: 'lang',
            value: toolCall.input.lang,
          },
        ]);
        const lang = toolCall.input.lang as string;
        params.agentParams.lang = lang;
        invocationCtx.setLang(lang);
      }

      switch (toolCall.toolName) {
        case ToolName.CONFIRMATION:
        case ToolName.ASK_USER: {
          await invocationCtx.updateConversationNote({
            newContent: toolCall.input.message,
            command: toolCall.toolName,
          });

          const callBack = async (): Promise<AgentResult> => {
            params.agentParams.invocationCount = (params.agentParams.invocationCount ?? 0) + 1;
            invocationCtx.incrementStep();
            return agent.handle(params.agentParams, {
              remainingSteps: params.remainingSteps,
              toolCalls: params.toolCalls,
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
          toolCallResult = await agent.activateToolHandler.handle(invocationCtx, {
            toolCall,
            activeTools: params.activeTools,
            availableTools: params.availableTools,
            agent: params.agentId,
          });
          break;
        }

        case ToolName.SPAWN_SUBAGENT: {
          const spawnHandler = handlerMap[ToolName.SPAWN_SUBAGENT] as
            | (() => handlers.SpawnSubagent)
            | undefined;
          if (!spawnHandler) {
            throw new Error(
              `ToolCallExecutor: No handler found for tool: ${ToolName.SPAWN_SUBAGENT}`
            );
          }
          toolCallResult = await spawnHandler().handle(invocationCtx, {
            toolCall,
            parentAgentId: params.agentId,
          });
          break;
        }

        default: {
          if (agent.plugin.mcpService.isMCPToolName(toolCall.toolName as string)) {
            toolCallResult = await agent.mcpToolHandler.handle(invocationCtx, {
              toolCall,
              messages: [],
            });
            break;
          }

          const streamInfo =
            params.toolContentStreamInfo?.toolCallId === toolCall.toolCallId
              ? params.toolContentStreamInfo
              : undefined;
          const invokeHandler = (middlewareCtx: ToolHandlerMiddlewareContext) => {
            const toolName = middlewareCtx.toolCall.toolName;
            const nestedHandlerGetter = handlerMap[toolName];
            if (!nestedHandlerGetter) {
              throw new Error(`No handler found for tool: ${toolName}`);
            }
            const handler = nestedHandlerGetter();
            return handler.handle(middlewareCtx.ctx, {
              toolCall: middlewareCtx.toolCall,
              toolContentStreamInfo: middlewareCtx.toolContentStreamInfo,
              continueFromNextTool: continueProcessingFromNextTool,
            });
          };
          const toolHandlerChain = createToolHandlerChain({
            middlewares: [createGuardrailsMiddleware(agent.plugin)],
            handler: invokeHandler,
          });
          toolCallResult = await toolHandlerChain({
            ctx: invocationCtx,
            toolCall,
            toolContentStreamInfo: streamInfo,
            agent,
          });
          break;
        }
      }

      if (toolCall.toolName === ToolName.TODO_WRITE) {
        await agent.plugin.conversationRenderer.removeIndicator(params.title);
      }

      if (!toolCallResult) {
        logger.warn('No tool result', { toolCall, toolCalls: params.toolCalls });
        continue;
      }

      if (toolCallResult.status !== IntentResultStatus.SUCCESS) {
        return toolCallResult;
      }
    }

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
