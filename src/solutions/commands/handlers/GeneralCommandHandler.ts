import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { CommandIntentExtraction, extractCommandIntent } from 'src/lib/modelfusion/extractions';

import type StewardPlugin from 'src/main';
import type { CommandProcessor } from '../CommandProcessor';

export class GeneralCommandHandler extends CommandHandler {
  isContentRequired = true;

  constructor(
    public readonly plugin: StewardPlugin,
    private readonly commandProcessor: CommandProcessor
  ) {
    super();
  }

  /**
   * Render the loading indicator for the general command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.orchestrating'));
  }

  /**
   * Handle a general command (space)
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      intentExtractionConfirmed?: boolean;
      extraction?: CommandIntentExtraction;
    } = {}
  ): Promise<CommandResult> {
    const { title, command } = params;
    const t = getTranslation(params.lang);

    try {
      let extraction = options.extraction;

      // If extraction is not provided, extract conversation history and then get command intent
      if (!extraction) {
        const conversationHistory = await this.renderer.extractConversationHistory(title);
        extraction = await extractCommandIntent(command, params.lang, conversationHistory);
      }

      // For low confidence intents, ask for confirmation before proceeding
      if (extraction.confidence <= 0.7 && !options.intentExtractionConfirmed) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.explanation,
          role: 'Steward',
          lang: extraction.lang,
        });

        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.abortedByLowConfidence')}*`,
          includeHistory: false,
          lang: extraction.lang,
        });

        // return {
        //   status: CommandResultStatus.NEEDS_CONFIRMATION,
        //   confirmationMessage,
        //   onConfirmation: async () => {
        //     console.log('onConfirmation');
        //     // If confirmed, process the commands with the confirmed flag
        //     this.handle(params, { intentExtractionConfirmed: true, extraction: intentExtraction });
        //   },
        //   onRejection: () => {
        //     // If rejected, add a message indicating the operation was cancelled
        //     this.renderer.updateConversationNote({
        //       path: title,
        //       newContent: `*${t('common.operationCancelled') || 'Operation cancelled.'}*`,
        //     });
        //   },
        // };

        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

      // Process the commands (either high confidence or confirmed)
      await this.commandProcessor.processCommands({
        title,
        commands: extraction.commands,
        lang: extraction.lang,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error processing your request: ${error.message}*`,
        lang: params.lang,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
