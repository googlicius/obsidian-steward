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
    await this.renderer.addGeneratingIndicator(title, t('conversation.workingOnIt'));
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
      // Extract the command intent using AI
      const intentExtraction =
        options.extraction ||
        (await extractCommandIntent(command.content, this.settings.llm, command.model));

      // For low confidence intents, ask for confirmation before proceeding
      if (intentExtraction.confidence <= 0.7 && !options.intentExtractionConfirmed) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: intentExtraction.explanation,
          role: 'Steward',
        });

        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.abortedByLowConfidence')}*`,
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
        commands: intentExtraction.commands,
        lang: intentExtraction.lang,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error processing your request: ${error.message}*`,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
