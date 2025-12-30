import { DynamicToolCall, Tool } from 'ai';
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

    // We provide the error and the valid schema of the tool so the AI can understand the error and fix it
    const errorValue = options.toolCall.error
      ? {
          message: 'Invalid tool call, please refer to the error for more details.',
          error: options.toolCall.error,
          validSchema: tool.inputSchema,
        }
      : {
          message: `Invalid tool call, please refer to the guidelines and schema of the ${options.toolCall.toolName} tool to see how to use it correctly.`,
        };

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
