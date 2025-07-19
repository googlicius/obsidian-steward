import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';

import type StewardPlugin from 'src/main';
import type { CommandProcessor } from '../CommandProcessor';

export class UserDefinedCommandHandler extends CommandHandler {
  isContentRequired = (commandType: string): boolean => {
    const userDefinedCommand =
      this.plugin.userDefinedCommandService?.userDefinedCommands.get(commandType);
    return !!(userDefinedCommand && userDefinedCommand.query_required);
  };

  constructor(
    public readonly plugin: StewardPlugin,
    private readonly commandProcessor: CommandProcessor
  ) {
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
    const { title, command, lang } = params;

    try {
      let commandIntents;
      try {
        commandIntents = this.plugin.userDefinedCommandService.expandUserDefinedCommandIntents(
          [
            {
              commandType: command.commandType,
              query: command.query,
              systemPrompts: command.systemPrompts,
            },
          ],
          command.query || ''
        );
      } catch (cycleError) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error: ${cycleError instanceof Error ? cycleError.message : cycleError}*`,
          role: 'Steward',
        });
        return {
          status: CommandResultStatus.ERROR,
          error: cycleError instanceof Error ? cycleError : new Error(String(cycleError)),
        };
      }

      if (!commandIntents || commandIntents.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*Error: User-defined command '${command.commandType}' not found or empty*`,
          role: 'Steward',
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error(`User-defined command '${command.commandType}' not found or empty`),
        };
      }

      if (commandIntents[0].model) {
        await this.renderer.updateConversationFrontmatter(title, [
          { name: 'model', value: commandIntents[0].model },
        ]);
      }

      // Process the expanded commands
      await this.commandProcessor.processCommands(
        {
          title,
          commands: commandIntents,
          lang,
        },
        { builtInCommandPrecedence: true }
      );

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error processing user-defined command: ${error.message}*`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
