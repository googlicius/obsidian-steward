import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { USER_PREFERENCE_WAITING_PLACEHOLDER } from 'src/constants';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart, type AskUserPreferenceInput } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';

const askUserPreferenceQuestionSchema = z.object({
  question: z
    .string()
    .describe('The question to ask the user when you need them to pick a preference.'),
  options: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe('2-6 short option labels the user can choose from.'),
});

const askUserPreferenceSchema = z.object({
  questions: z
    .array(askUserPreferenceQuestionSchema)
    .min(1)
    .max(5)
    .describe(
      'One or more questions to ask the user before continuing. Each is shown with its own options; group related choices here instead of making multiple separate calls.'
    ),
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
    const { questions } = toolCall.input;

    if (!questions || questions.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: 'ask_user_preference requires at least one question.',
      };
    }

    for (const { options: questionOptions } of questions) {
      if (!questionOptions || questionOptions.length < 2 || questionOptions.length > 6) {
        return {
          status: IntentResultStatus.ERROR,
          error: 'ask_user_preference requires between 2 and 6 options per question.',
        };
      }
    }

    const waitingValue = questions
      .map((_, i) => `Q${i + 1}: ${USER_PREFERENCE_WAITING_PLACEHOLDER}`)
      .join('\n');

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
            value: waitingValue,
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
