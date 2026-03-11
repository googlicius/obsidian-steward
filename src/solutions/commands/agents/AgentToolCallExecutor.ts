import { NoSuchToolError } from 'ai';
import type { DynamicToolCall, Tool } from 'ai';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { createGuardrailsMiddleware } from 'src/services/GuardrailsRuleService/guardrailsMiddleware';
import { createToolHandlerChain } from './middleware/createToolHandlerChain';
import type { AgentHandlerParams, AgentResult } from '../types';
import { IntentResultStatus } from '../types';
import type { TypedToolCallPart } from '../tools/types';
import { ToolName } from '../ToolRegistry';
import type { ToolContentStreamInfo } from './SuperAgent/SuperAgentToolContentStream';
import type { StandardToolHandler } from './AgentHandlers';
import * as handlers from './handlers';
import { ToolHandlerMiddlewareContext } from './middleware/types';

interface AgentToolCallExecutorContext {
  plugin: StewardPlugin;
  renderIndicator(title: string, lang?: string | null, toolName?: ToolName): Promise<void>;
  handle: (
    params: AgentHandlerParams,
    options?: {
      remainingSteps?: number;
      toolCalls?: unknown;
      currentToolCallIndex?: number;
    }
  ) => Promise<AgentResult>;
  getToolHandlerMap(): Partial<Record<ToolName, () => StandardToolHandler>>;
  getPathsForGuardrails(toolName: ToolName, input: unknown): string[];
  filterInputForGuardrails(toolCall: TypedToolCallPart, allowedPaths: string[]): unknown | null;
  dynamic: handlers.Dynamic;
  activateToolHandler: handlers.ActivateToolHandler;
  todoList: handlers.TodoList;
  useSkills: handlers.UseSkills;
  conclude: handlers.Conclude;
}

function asAgentToolCallExecutor(instance: AgentToolCallExecutor): AgentToolCallExecutorContext {
  return instance as unknown as AgentToolCallExecutorContext;
}

export class AgentToolCallExecutor {
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
    activeSkills: string[];
    availableTools: { [x: string]: Tool };
    toolContentStreamInfo?: ToolContentStreamInfo;
  }): Promise<AgentResult> {
    const agent = asAgentToolCallExecutor(this);
    const handlerMap = agent.getToolHandlerMap();

    const firstToolName =
      params.toolCalls.length > params.startIndex && !params.toolCalls[params.startIndex]?.dynamic
        ? params.toolCalls[params.startIndex].toolName
        : undefined;
    let timer: number | null = null;
    timer = window.setTimeout(() => {
      agent.renderIndicator(params.title, params.lang, firstToolName);
    }, 2000);

    try {
      for (let index = params.startIndex; index < params.toolCalls.length; index += 1) {
        const toolCall = params.toolCalls[index];
        let toolCallResult: AgentResult | undefined;
        const continueProcessingFromNextTool = async (): Promise<AgentResult> => {
          params.agentParams.invocationCount = (params.agentParams.invocationCount ?? 0) + 1;
          return agent.handle(params.agentParams, {
            remainingSteps: params.remainingSteps,
            toolCalls: params.toolCalls,
            currentToolCallIndex: index + 1,
          });
        };

        if (toolCall.dynamic) {
          const prevToolCall = index > 0 ? params.toolCalls[index - 1] : undefined;
          const dynamicToolCall = toolCall as unknown as DynamicToolCall;
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
            return agent.handle(params.agentParams, {
              remainingSteps: params.remainingSteps,
            });
          }

          await agent.dynamic.handle(params.agentParams, {
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
          params.agentParams.lang = toolCall.input.lang as string;
        }

        switch (toolCall.toolName) {
          case ToolName.CONFIRMATION:
          case ToolName.ASK_USER: {
            await agent.plugin.conversationRenderer.updateConversationNote({
              path: params.title,
              newContent: toolCall.input.message,
              lang: params.agentParams.lang,
              handlerId: params.handlerId,
              command: toolCall.toolName,
              step: params.agentParams.invocationCount,
            });

            const callBack = async (): Promise<AgentResult> => {
              params.agentParams.invocationCount = (params.agentParams.invocationCount ?? 0) + 1;
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
            toolCallResult = await agent.activateToolHandler.handle(params.agentParams, {
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
                `AgentToolCallExecuter: No handler found for tool: ${ToolName.SPAWN_SUBAGENT}`
              );
            }
            toolCallResult = await spawnHandler().handle(params.agentParams, {
              toolCall,
              parentAgentId: params.agentId,
            });
            break;
          }

          case ToolName.TODO_LIST_UPDATE: {
            toolCallResult = await agent.todoList.handleUpdate(params.agentParams, {
              toolCall,
            });
            break;
          }

          case ToolName.USE_SKILLS: {
            toolCallResult = await agent.useSkills.handle(params.agentParams, {
              toolCall,
              activeSkills: params.activeSkills,
            });
            break;
          }

          case ToolName.CONCLUDE: {
            const prevToolCall = params.toolCalls.length > 1 && params.toolCalls[index - 1];
            if (prevToolCall && prevToolCall.dynamic) {
              continue;
            }
            if (params.toolCalls.length === 1) {
              logger.warn(`Conclude tool was called alone.`);
            }
            toolCallResult = await agent.conclude.handle(params.agentParams, {
              toolCall,
            });
            break;
          }

          default: {
            const streamInfo =
              params.toolContentStreamInfo?.toolCallId === toolCall.toolCallId
                ? params.toolContentStreamInfo
                : undefined;
            const invokeHandler = (ctx: ToolHandlerMiddlewareContext) => {
              const toolName = ctx.toolCall.toolName;
              const nestedHandlerGetter = handlerMap[toolName];
              if (!nestedHandlerGetter) {
                throw new Error(`No handler found for tool: ${toolName}`);
              }
              const handler = nestedHandlerGetter();
              return handler.handle(ctx.params, {
                toolCall: ctx.toolCall,
                toolContentStreamInfo: ctx.toolContentStreamInfo,
                continueFromNextTool: continueProcessingFromNextTool,
              });
            };
            const toolHandlerChain = createToolHandlerChain({
              middlewares: [createGuardrailsMiddleware(agent.plugin)],
              handler: invokeHandler,
            });
            toolCallResult = await toolHandlerChain({
              params: params.agentParams,
              toolCall,
              toolContentStreamInfo: streamInfo,
              agent,
            });
            break;
          }
        }

        if (timer && [ToolName.CONCLUDE, ToolName.TODO_LIST_UPDATE].includes(toolCall.toolName)) {
          clearTimeout(timer);
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
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
