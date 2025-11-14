import { CommandHandler, CommandHandlerParams, CommandResult } from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import type StewardPlugin from 'src/main';
import { IntentResultStatus } from '../types';

export class UserDefinedCommandHandler extends CommandHandler {
  isContentRequired = (commandType: string): boolean => {
    const userDefinedCommand =
      this.plugin.userDefinedCommandService?.userDefinedCommands.get(commandType);
    return !!(userDefinedCommand && userDefinedCommand.normalized.query_required);
  };

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for user-defined commands
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.orchestrating'));
  }

  /**
   * Handle a user-defined command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, intent, lang } = params;

    let commandIntents;
    try {
      commandIntents = this.plugin.userDefinedCommandService.expandUserDefinedCommandIntents(
        {
          type: intent.type,
          query: intent.query,
          systemPrompts: intent.systemPrompts,
        },
        intent.query || ''
      );
    } catch (cycleError) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error: ${cycleError instanceof Error ? cycleError.message : cycleError}*`,
        role: 'Steward',
      });
      return {
        status: IntentResultStatus.ERROR,
        error: cycleError instanceof Error ? cycleError : new Error(String(cycleError)),
      };
    }

    if (!commandIntents || commandIntents.length === 0) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error: User-defined command '${intent.type}' not found or empty*`,
        role: 'Steward',
      });

      return {
        status: IntentResultStatus.ERROR,
        error: new Error(`User-defined command '${intent.type}' not found or empty`),
      };
    }

    // Store the model and user-defined command name in frontmatter
    const frontmatterUpdates = [{ name: 'udc_command', value: intent.type }];

    if (commandIntents[0].model) {
      frontmatterUpdates.push({ name: 'model', value: commandIntents[0].model });
    }
    await this.renderer.updateConversationFrontmatter(title, frontmatterUpdates);

    // Process the expanded commands
    await this.commandProcessor.processIntents(
      {
        title,
        intents: commandIntents,
        lang,
      },
      { builtInCommandPrecedence: true }
    );

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
