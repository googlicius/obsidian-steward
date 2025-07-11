import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { createTextStream } from 'src/utils/textStreamer';

import type StewardPlugin from 'src/main';

export class ThankYouCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Handle a thank you command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, nextCommand, lang } = params;
    const t = getTranslation(lang);

    let responseText: string;

    if (nextCommand) {
      // If nextCommand is present, use a simple response
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
    await this.renderer.streamConversationNote({
      path: title,
      stream: textStream,
      command: 'thank_you',
      role: 'Steward',
    });

    return {
      status: CommandResultStatus.SUCCESS,
    };
  }
}
