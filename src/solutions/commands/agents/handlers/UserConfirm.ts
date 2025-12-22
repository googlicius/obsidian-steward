import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';

// USER_CONFIRM tool doesn't need args - it's just a trigger for confirmation flow
const userConfirmSchema = z.object({});

export type UserConfirmArgs = z.infer<typeof userConfirmSchema>;

export class UserConfirm {
  private static readonly userConfirmTool = tool({
    inputSchema: userConfirmSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getUserConfirmTool() {
    return UserConfirm.userConfirmTool;
  }

  /**
   * Handle user confirmation tool call
   * This handles the confirmation flow similar to ConfirmCommandHandler
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<UserConfirmArgs> }
  ): Promise<AgentResult> {
    const { title, intent, lang, handlerId } = params;

    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('UserConfirm.handle invoked without handlerId');
    }

    // Get lastResult from conversation-level storage (accessible across processors)
    const lastResult = this.agent.commandProcessor.getLastResult(title);

    if (!lastResult || lastResult.status !== IntentResultStatus.NEEDS_CONFIRMATION) {
      const history = (await this.agent.renderer.extractAllConversationMessages(title)).filter(
        message =>
          message.intent !== 'summary' &&
          message.intent !== 'confirm' &&
          message.history !== false &&
          message.role === 'assistant'
      );

      if (history.length === 0) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('confirmation.noPending'),
          lang,
          handlerId,
        });

        return {
          status: IntentResultStatus.STOP_PROCESSING,
          reason: `*${t('confirmation.noPending')}*`,
        };
      }

      logger.log('No pending command to confirm, letting LLMs handle it.');

      // If the previous message was a assistant question, it is more likely that the user is responding to the previous message.
      const prevMessage = history[history.length - 1];
      if (prevMessage.role === 'assistant' && this.isAQuestion(prevMessage.content)) {
        return {
          status: IntentResultStatus.SUCCESS,
        };
      }

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('confirmation.noPending')}*`,
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.STOP_PROCESSING,
        reason: `*${t('confirmation.noPending')}*`,
      };
    }

    // Parse the user's confirmation response from the intent query
    const confirmationIntent = this.isConfirmIntent(intent);

    if (!confirmationIntent) {
      // If it's not a clear confirmation, let the user know
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: t('confirmation.notUnderstood'),
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: t('confirmation.notUnderstood'),
      };
    }

    let confirmResult: AgentResult | undefined;

    // Handle the confirmation or rejection
    if (confirmationIntent.isAffirmative) {
      confirmResult = await lastResult.onConfirmation(intent.query);
    } else {
      if (lastResult.onRejection) {
        confirmResult = await lastResult.onRejection(intent.query);
      }

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('confirmation.operationCancelled')}*`,
        lang,
        handlerId,
      });
    }

    // If there's an onFinal callback, execute it with the result
    // This allows handlers to continue their internal flow
    if (lastResult.onFinal) {
      await lastResult.onFinal();
    }

    // Clear the conversation lastResult after handling confirmation
    if (confirmResult && confirmResult.status === IntentResultStatus.SUCCESS) {
      this.agent.commandProcessor.clearLastResult(title);
      // Continue processing the command queue if confirmation was successful
      await this.agent.commandProcessor.continueProcessing(title);
    } else if (confirmResult && confirmResult.status === IntentResultStatus.ERROR) {
      this.agent.commandProcessor.clearLastResult(title);
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
   * @param intent The intent to check
   * @returns An object with the response type or null if not a clear response
   */
  private isConfirmIntent(intent: {
    type: string;
    query: string;
  }): { isConfirmation: boolean; isAffirmative: boolean } | null {
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
