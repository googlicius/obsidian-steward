import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { CommandIntent } from 'src/types/types';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

export class ConfirmCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Handle a confirmation command by checking if the previous command needs confirmation
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command, lang } = params;
    const t = getTranslation(lang);

    const confirmationIntent = this.isConfirmIntent(command);

    if (!confirmationIntent) {
      // If it's not a clear confirmation, let the user know
      await this.renderer.updateConversationNote({
        path: title,
        newContent: t('confirmation.notUnderstood'),
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error: t('confirmation.notUnderstood'),
      };
    }

    // Get the pending command data
    const pendingCommandData = this.commandProcessor.getPendingCommand(title);
    if (
      !pendingCommandData ||
      !pendingCommandData.lastCommandResult ||
      pendingCommandData.lastCommandResult.status !== CommandResultStatus.NEEDS_CONFIRMATION
    ) {
      const history = (await this.renderer.extractAllConversationMessages(title)).filter(
        message =>
          message.command !== 'summary' &&
          message.command !== 'confirm' &&
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
          status: CommandResultStatus.ERROR,
          error: t('confirmation.noPending'),
        };
      }

      logger.log('No pending command to confirm, letting LLMs handle it.');

      // If the previous message was a generate command, it is more likely that the user is responding to the previous message.
      const prevMessage = history[history.length - 1];
      if (prevMessage.command === 'generate' && this.isAQuestion(prevMessage.content)) {
        // Forward the query to the generate command.
        await this.commandProcessor.processCommands({
          title,
          commands: [
            {
              commandType: 'generate',
              query: params.command.query,
            },
          ],
        });

        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

      // Otherwise, it is something else.
      // else {
      //   await this.commandProcessor.processCommands(
      //     {
      //       title,
      //       commands: [
      //         {
      //           commandType: ' ',
      //           query: params.command.query,
      //         },
      //       ],
      //     },
      //     {
      //       sendToDownstream: {
      //         ignoreClassify: true,
      //       },
      //     }
      //   );
      // }

      await this.plugin.conversationRenderer.updateConversationNote({
        path: title,
        newContent: `*${t('confirmation.noPending')}*`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    }

    const lastResult = pendingCommandData.lastCommandResult;

    let confirmResult: CommandResult | undefined;

    // Handle the confirmation or rejection
    if (confirmationIntent.isAffirmative) {
      confirmResult = await lastResult.onConfirmation(command.query);
    } else {
      if (lastResult.onRejection) {
        confirmResult = await lastResult.onRejection(command.query);
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
    if (confirmResult && confirmResult.status === CommandResultStatus.SUCCESS) {
      await this.commandProcessor.continueProcessing(title);
    }

    return confirmResult || { status: CommandResultStatus.SUCCESS };
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
    command: CommandIntent
  ): { isConfirmation: boolean; isAffirmative: boolean } | null {
    let commandContent = command.query;

    switch (command.commandType) {
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
