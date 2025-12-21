import { tool } from 'ai';
import { z } from 'zod';
import { type SuperAgent } from '../SuperAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { createTextStream } from 'src/utils/textStreamer';

// THANK_YOU tool doesn't need args
const thankYouSchema = z.object({});

export type ThankYouArgs = z.infer<typeof thankYouSchema>;

export class ThankYou {
  private static readonly thankYouTool = tool({
    parameters: thankYouSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getThankYouTool() {
    return ThankYou.thankYouTool;
  }

  /**
   * Handle thank you tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, ThankYouArgs> }
  ): Promise<AgentResult> {
    const { title, nextIntent, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('ThankYou.handle invoked without handlerId');
    }

    let responseText: string;

    if (nextIntent) {
      // If nextIntent is present, use a simple response
      responseText = t('thankYou.simpleResponse');
    } else {
      // Get a random response from the list
      const responses = [
        t('thankYou.response1'),
        t('thankYou.response2'),
        t('thankYou.response3'),
        t('thankYou.response4'),
        t('thankYou.response5'),
      ];

      responseText = responses[Math.floor(Math.random() * responses.length)];
    }

    // Use text streamer to simulate typing
    const textStream = createTextStream(responseText);

    // Stream the response to the conversation
    await this.agent.renderer.streamConversationNote({
      path: title,
      stream: textStream,
      command: 'thank_you',
      handlerId,
    });

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }
}
