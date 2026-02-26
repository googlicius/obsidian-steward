import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import type { ModelMessage } from 'ai';

const MSG_PREFIX = 'msg-';

export const recallCompactedContextSchema = z
  .object({
    messageIds: z.array(z.string()).optional(),
  })
  .transform(value => {
    const messageIds = value.messageIds?.map(id =>
      id.startsWith(MSG_PREFIX) ? id.slice(MSG_PREFIX.length) : id
    );
    return { ...value, messageIds };
  });

export type RecallCompactedContextArgs = z.infer<typeof recallCompactedContextSchema>;

export interface RecallCompactedContextResult {
  /** Messages in ModelMessage format (same as extractConversationHistory) */
  messages: ModelMessage[];
  missingMessageIds: string[];
}

export async function resolveRecallCompactedContext(params: {
  renderer: SuperAgent['renderer'];
  conversationTitle: string;
  args: RecallCompactedContextArgs;
}): Promise<RecallCompactedContextResult> {
  const { renderer, conversationTitle, args } = params;
  const messages: ModelMessage[] = [];
  const missingMessageIds: string[] = [];

  if (!args.messageIds || args.messageIds.length === 0) {
    return { messages, missingMessageIds };
  }

  for (const messageId of args.messageIds) {
    const rawMessage = await renderer.getMessageById(conversationTitle, messageId, true);
    if (!rawMessage) {
      missingMessageIds.push(messageId);
      continue;
    }

    const modelMessages = await renderer.convertMessageToModelFormat(
      conversationTitle,
      rawMessage
    );
    for (const msg of modelMessages) {
      messages.push(msg);
    }
  }

  return { messages, missingMessageIds };
}

export class RecallCompactedContext {
  private static readonly recallCompactedContextTool = tool({
    inputSchema: recallCompactedContextSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getRecallCompactedContextTool() {
    return RecallCompactedContext.recallCompactedContextTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<RecallCompactedContextArgs> }
  ): Promise<AgentResult> {
    const { title, handlerId } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('RecallCompactedContext.handle invoked without handlerId');
    }

    const result = await resolveRecallCompactedContext({
      renderer: this.agent.renderer,
      conversationTitle: title,
      args: toolCall.input,
    });

    await this.agent.serializeInvocation({
      title,
      command: 'recall_compacted_context',
      handlerId,
      step: params.invocationCount,
      toolCall,
      result: {
        type: 'text',
        value: JSON.stringify(result),
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
