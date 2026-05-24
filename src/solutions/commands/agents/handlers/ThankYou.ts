import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { createTextStream } from 'src/utils/textStreamer';

const { getTranslation } = getBundledInternal('i18n');

// THANK_YOU tool doesn't need args
const thankYouSchema = z.object({});

export type ThankYouArgs = z.infer<typeof thankYouSchema>;

export class ThankYou {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getThankYouTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: thankYouSchema,
    });
  }

  /**
   * Handle thank you tool call
   */
  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<ThankYouArgs> }
  ): Promise<AgentResult> {
    const t = getTranslation(ctx.lang);

    // Get a random response from the list
    const responses = [
      t('thankYou.response1'),
      t('thankYou.response2'),
      t('thankYou.response3'),
      t('thankYou.response4'),
      t('thankYou.response5'),
    ];

    const responseText = responses[Math.floor(Math.random() * responses.length)];

    // Use text streamer to simulate typing
    const textStream = createTextStream(responseText);

    await this.agent.renderer.streamConversationNote({
      path: ctx.title,
      stream: textStream,
      command: 'thank_you',
      handlerId: ctx.handlerId,
      step: ctx.step,
    });

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }
}
