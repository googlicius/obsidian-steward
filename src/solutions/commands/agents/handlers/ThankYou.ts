import { getCdnLib } from 'src/utils/cdnUrls';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { createTextStream } from 'src/utils/textStreamer';

// THANK_YOU tool doesn't need args
const thankYouSchema = z.object({});

export type ThankYouArgs = z.infer<typeof thankYouSchema>;

export class ThankYou {
  constructor(private readonly agent: SuperAgent) {}

  public static async getThankYouTool() {
    const { tool } = await getCdnLib('ai');
    return tool({ inputSchema: thankYouSchema });
  }

  /**
   * Handle thank you tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<ThankYouArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('ThankYou.handle invoked without handlerId');
    }

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
