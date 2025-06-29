import { getTranslation } from 'src/i18n';
import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';

import type StewardPlugin from 'src/main';

/**
 * Handler for close commands
 * Closes the conversation and removes the conversation link from the editor
 */
export class CloseCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Handle a close command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, lang } = params;
    const t = getTranslation(lang);

    try {
      const success = await this.plugin.closeConversation(title);

      if (!success) {
        return {
          status: CommandResultStatus.ERROR,
          error: new Error('Failed to close conversation'),
        };
      }

      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('chat.conversationClosed'),
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      console.error('Error closing conversation:', error);

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
