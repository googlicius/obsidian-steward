import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { extractCommandIntent } from 'src/lib/modelfusion/extractions';
import { CommandProcessor } from '../CommandProcessor';

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
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command } = params;

    try {
      // Extract the command intent using AI
      const intentExtraction = await extractCommandIntent(
        command.content,
        this.settings.llm,
        this.plugin.app
      );

      // For low confidence intents, just show the explanation without further action
      if (intentExtraction.confidence <= 0.7) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: intentExtraction.explanation,
          role: 'Steward',
        });

        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

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
