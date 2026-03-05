import {
  DynamicToolCall,
  Tool,
  asSchema,
  NoSuchToolError,
  InvalidToolInputError,
  InvalidArgumentError,
} from 'ai';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { removeUndefined } from 'src/utils/removeUndefined';
import { logger } from 'src/utils/logger';

/**
 * Handles dynamic tool calls that are not supported
 */
export class Dynamic {
  constructor(private readonly renderer: ConversationRenderer) {}

  private isNoSuchToolError(error: unknown): error is NoSuchToolError {
    return error instanceof NoSuchToolError;
  }

  private isInvalidToolError(
    error: unknown
  ): error is InvalidToolInputError | InvalidArgumentError {
    return error instanceof InvalidToolInputError || error instanceof InvalidArgumentError;
  }

  private getErrorValue(options: {
    toolCall: DynamicToolCall;
    tool?: Tool;
  }): Record<string, unknown> {
    const error = options.toolCall.error;

    if (this.isNoSuchToolError(error)) {
      return {
        message:
          'No such tool found. If you need this tool, call `activate_tools` first before using it.',
        error,
      };
    }

    if (this.isInvalidToolError(error)) {
      return {
        message:
          'Invalid tool call, please refer to the error for more details. And refer to the validSchema to see how to use it correctly.',
        error,
        validSchema: options.tool ? asSchema(options.tool.inputSchema).jsonSchema : undefined,
      };
    }

    return {
      message: `Invalid tool call, please refer to the guidelines and schema of the ${options.toolCall.toolName} tool to see how to use it correctly.`,
    };
  }

  /**
   * Handle dynamic tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: DynamicToolCall;
      tools: { [x: string]: Tool };
    }
  ): Promise<AgentResult> {
    const t = getTranslation(params.lang);

    if (!params.handlerId) {
      throw new Error('Dynamic.handle invoked without handlerId');
    }

    logger.warn('Dynamic tool call is not supported.', { toolCall: options.toolCall });
    await this.renderer.updateConversationNote({
      path: params.title,
      newContent: `*${t('common.invalidOrDynamicToolCall', { toolName: options.toolCall.toolName })}*`,
      lang: params.lang,
      handlerId: params.handlerId,
      includeHistory: false,
    });

    const tool = options.tools[options.toolCall.toolName];

    // Build error payload based on concrete error type so AI can self-correct.
    const errorValue = this.getErrorValue({
      toolCall: options.toolCall,
      tool,
    });

    // Remove error field before serializing
    const toolCallWithoutError = {
      ...options.toolCall,
      error: undefined,
    };
    await this.renderer.serializeToolInvocation({
      path: params.title,
      command: 'dynamic-tool-call',
      handlerId: params.handlerId,
      toolInvocations: [
        {
          ...toolCallWithoutError,
          type: 'tool-result',
          output: {
            type: 'error-json',
            value: removeUndefined(errorValue),
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
