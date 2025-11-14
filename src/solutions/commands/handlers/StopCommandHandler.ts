import { CommandHandler, CommandHandlerParams, CommandResult } from '../CommandHandler';
import type StewardPlugin from 'src/main';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { delay } from 'src/utils/delay';
import { IntentResultStatus } from '../types';

/**
 * Handler for the stop command
 */
export class StopCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Handle the stop command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, lang } = params;
    const t = getTranslation(lang);

    // Get the count of active operations before stopping
    const activeOperationsCount = this.plugin.abortService.getActiveOperationsCount();

    this.plugin.abortService.abortAllOperations();

    // Log the action
    logger.log(`Stop command received - aborted all operations (${activeOperationsCount} active)`);

    // Prepare the response message
    let responseMessage = t('stop.stopped');

    // Add count of operations if there were any
    if (activeOperationsCount > 0) {
      responseMessage = t('stop.stoppedWithCount', { count: activeOperationsCount });
    } else {
      responseMessage = t('stop.noActiveOperations');
    }

    await delay(800);

    await this.renderer.updateConversationNote({
      path: title,
      newContent: responseMessage,
      role: 'Steward',
      command: 'stop',
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
