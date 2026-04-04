import type { ModelMessage } from 'ai';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { ToolCallPart, ToolResultPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { removeUndefined } from 'src/utils/removeUndefined';

/**
 * Executes MCP tools (dynamic tool names: {@code mcp__...}) via {@link MCPService}.
 */
export class McpToolHandler {
  constructor(private readonly agentContext: AgentHandlerContext) {}

  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<unknown>;
      messages?: ModelMessage[];
    }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const toolName = toolCall.toolName as string;

    if (!this.agentContext.plugin.mcpService.isMCPToolName(toolName)) {
      throw new Error(`McpToolHandler: expected MCP tool name, got ${toolName}`);
    }

    const mcpResult = await this.agentContext.plugin.mcpService.executeActiveToolCall({
      conversationTitle: params.title,
      toolCall: {
        toolName,
        input: toolCall.input,
        toolCallId: toolCall.toolCallId,
      },
      messages: options.messages ?? [],
    });

    const handlerId = params.handlerId;
    if (!handlerId) {
      throw new Error('McpToolHandler.handle invoked without handlerId');
    }

    await this.agentContext.renderer.serializeToolInvocation({
      path: params.title,
      command: toolName,
      handlerId,
      step: params.invocationCount,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: this.toToolResultOutput(mcpResult),
        },
      ],
    });

    return { status: IntentResultStatus.SUCCESS };
  }

  private toToolResultOutput(result: unknown): ToolResultPart['output'] {
    if (typeof result === 'string') {
      return {
        type: 'text',
        value: result,
      };
    }

    return {
      type: 'json',
      value: removeUndefined(result as object),
    };
  }
}
