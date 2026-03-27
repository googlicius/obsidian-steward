import type {
  DynamicToolCall,
  Tool,
  NoSuchToolError,
  InvalidToolInputError,
  InvalidArgumentError,
} from 'ai';
import { getBundledLib } from 'src/utils/bundledLibs';
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

  private isNoSuchToolError(
    error: unknown,
    NoSuchToolErrorCtor: typeof NoSuchToolError
  ): error is NoSuchToolError {
    return error instanceof NoSuchToolErrorCtor;
  }

  private isInvalidToolError(
    error: unknown,
    InvalidToolInputErrorCtor: typeof InvalidToolInputError,
    InvalidArgumentErrorCtor: typeof InvalidArgumentError
  ): error is InvalidToolInputError | InvalidArgumentError {
    return (
      error instanceof InvalidToolInputErrorCtor || error instanceof InvalidArgumentErrorCtor
    );
  }

  private getErrorValue(options: {
    toolCall: DynamicToolCall;
    tool?: Tool;
    aiModule: Awaited<ReturnType<typeof getBundledLib<'ai'>>>;
  }): Record<string, unknown> {
    const { toolCall, tool: toolDef, aiModule } = options;
    const error = toolCall.error;
    const { NoSuchToolError: NoSuchToolErr, InvalidToolInputError: InvalidToolInputErr } = aiModule;
    const { InvalidArgumentError: InvalidArgumentErr, asSchema } = aiModule;

    if (this.isNoSuchToolError(error, NoSuchToolErr)) {
      return {
        message:
          'No such tool found. If you need this tool, call `activate_tools` first before using it.',
        error,
      };
    }

    if (this.isInvalidToolError(error, InvalidToolInputErr, InvalidArgumentErr)) {
      return {
        message:
          'Invalid tool call, please refer to the error for more details. And refer to the validSchema to see how to use it correctly.',
        error,
        validSchema: toolDef ? asSchema(toolDef.inputSchema).jsonSchema : undefined,
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
    const aiModule = await getBundledLib('ai');

    const errorValue = this.getErrorValue({
      toolCall: options.toolCall,
      tool,
      aiModule,
    });

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
