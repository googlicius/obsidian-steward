import { getTranslation } from 'src/i18n';
import { CommandHandler, CommandHandlerParams, CommandResult } from '../CommandHandler';

import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { IntentResultStatus } from '../types';

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
          status: IntentResultStatus.ERROR,
          error: new Error('Failed to close conversation'),
        };
      }

      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('chat.conversationClosed'),
        role: 'Steward',
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error closing conversation:', error);

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }
}
