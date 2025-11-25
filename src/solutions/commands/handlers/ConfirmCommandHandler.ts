import { CommandHandler, CommandHandlerParams, CommandResult } from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { Intent, IntentResultStatus } from '../types';

export class ConfirmCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Handle a confirmation command by checking if the previous command needs confirmation
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, intent, lang } = params;
    const t = getTranslation(lang);

    const confirmationIntent = this.isConfirmIntent(intent);

    if (!confirmationIntent) {
      // If it's not a clear confirmation, let the user know
      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('confirmation.notUnderstood'),
        role: 'Steward',
      });

      return {
        status: IntentResultStatus.ERROR,
        error: t('confirmation.notUnderstood'),
      };
    }

    // Get the pending command data
    const pendingCommandData = this.commandProcessor.getPendingIntent(title);
    if (
      !pendingCommandData ||
      !pendingCommandData.lastResult ||
      pendingCommandData.lastResult.status !== IntentResultStatus.NEEDS_CONFIRMATION
    ) {
      const history = (await this.renderer.extractAllConversationMessages(title)).filter(
        message =>
          message.intent !== 'summary' &&
          message.intent !== 'confirm' &&
          message.history !== false &&
          message.role === 'assistant'
      );

      if (history.length === 0) {
        await this.plugin.conversationRenderer.updateConversationNote({
          path: title,
          newContent: t('confirmation.noPending'),
          role: 'Steward',
        });

        return {
          status: IntentResultStatus.ERROR,
          error: t('confirmation.noPending'),
        };
      }

      logger.log('No pending command to confirm, letting LLMs handle it.');

      // If the previous message was a generate command, it is more likely that the user is responding to the previous message.
      const prevMessage = history[history.length - 1];
      if (prevMessage.intent === 'generate' && this.isAQuestion(prevMessage.content)) {
        // Forward the query to the generate command.
        await this.commandProcessor.processIntents({
          title,
          intents: [
            {
              type: 'generate',
              query: intent.query,
            },
          ],
        });

        return {
          status: IntentResultStatus.SUCCESS,
        };
      }

      await this.plugin.conversationRenderer.updateConversationNote({
        path: title,
        newContent: `*${t('confirmation.noPending')}*`,
        role: 'Steward',
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    const lastResult = pendingCommandData.lastResult;

    let confirmResult: CommandResult | undefined;

    // Handle the confirmation or rejection
    if (confirmationIntent.isAffirmative) {
      confirmResult = await lastResult.onConfirmation(intent.query);
    } else {
      if (lastResult.onRejection) {
        confirmResult = await lastResult.onRejection(intent.query);
      }

      await this.plugin.conversationRenderer.updateConversationNote({
        path: title,
        newContent: `*${t('confirmation.operationCancelled')}*`,
        role: 'Steward',
      });
    }

    // If there's an onFinal callback, execute it with the result
    // This allows handlers to continue their internal flow
    if (lastResult.onFinal) {
      await lastResult.onFinal();
    }

    // Standard flow: continue processing the command queue if confirmation was successful
    if (confirmResult && confirmResult.status === IntentResultStatus.SUCCESS) {
      await this.commandProcessor.continueProcessing(title);
    }

    return confirmResult || { status: IntentResultStatus.SUCCESS };
  }

  /**
   * A simple check if a content a message is a question.
   */
  private isAQuestion(content: string): boolean {
    return content.endsWith('?');
  }

  /**
   * Check if a message is a clear confirmation response (yes/no)
   * @param message The message to check
   * @returns An object with the response type or null if not a clear response
   */
  private isConfirmIntent(
    intent: Intent
  ): { isConfirmation: boolean; isAffirmative: boolean } | null {
    let commandContent = intent.query;

    switch (intent.type) {
      case 'yes':
        commandContent = 'yes';
        break;
      case 'no':
        commandContent = 'no';
        break;
    }

    if (!commandContent) {
      return {
        isAffirmative: true,
        isConfirmation: true,
      };
    }

    // Parse the user's response
    const normalized = commandContent.toLowerCase().trim();

    const isAffirmative = [
      // English affirmative terms
      'yes',
      'y',
      'sure',
      'ok',
      'yeah',
      'yep',
      'create',
      'confirm',
      'proceed',
      'go ahead',
      'approve',
      'agree',
      // Vietnamese affirmative terms
      'có',
      'có nha',
      'đồng ý',
      'vâng',
      'ừ',
      'tạo',
      'tiếp tục',
    ].some(term => normalized === term);

    const isNegative = [
      // English negative terms
      'no',
      'n',
      'nope',
      "don't",
      'dont',
      'cancel',
      'stop',
      'reject',
      'disagree',
      // Vietnamese negative terms
      'không',
      'không nha',
      'đừng',
      'hủy',
      'dừng lại',
    ].some(term => normalized === term);

    // If it matches either pattern, it's a confirmation
    if (isAffirmative || isNegative) {
      return {
        isConfirmation: true,
        isAffirmative: isAffirmative,
      };
    }

    // If not a clear response, return null
    return null;
  }
}
