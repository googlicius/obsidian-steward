import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart, type AskUserPreferenceInput } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';

const askUserPreferenceSchema = z.object({
  question: z
    .string()
    .describe('The question to ask the user when you need them to pick a preference.'),
  options: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe('2-6 short option labels the user can choose from.'),
});

export type AskUserPreferenceArgs = z.infer<typeof askUserPreferenceSchema>;

export class AskUserPreference {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getAskUserPreferenceTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: askUserPreferenceSchema,
    });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<AskUserPreferenceInput> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const { question, options: preferenceOptions } = toolCall.input;

    if (preferenceOptions.length < 2 || preferenceOptions.length > 6) {
      return {
        status: IntentResultStatus.ERROR,
        error: 'ask_user_preference requires between 2 and 6 options.',
      };
    }

    await ctx.updateConversationNote({
      newContent: question,
      includeHistory: false,
    });

    const messageId = await this.agent.renderer.serializeToolInvocation({
      path: ctx.title,
      command: ToolName.ASK_USER_PREFERENCE,
      handlerId: ctx.handlerId,
      step: ctx.step,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'text',
            value: 'waiting_for_user_answer',
          },
        },
      ],
    });

    if (!messageId) {
      return {
        status: IntentResultStatus.ERROR,
        error: 'Failed to serialize ask_user_preference tool invocation.',
      };
    }

    await this.agent.renderer.showPreferenceButtons({
      conversationTitle: ctx.title,
      messageId,
    });

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }
}
