import { getTranslation } from 'src/i18n';
import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';

/**
 * Handler for help commands
 * Lists all available built-in and user-defined commands
 */
export class HelpCommandHandler extends CommandHandler {
  isContentRequired = false;

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the help command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));
  }

  /**
   * Handle a help command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, lang } = params;
    const t = getTranslation(lang);

    try {
      // Format the commands list
      let content = `${t('common.availableCommands')}\n\n`;

      // Add built-in commands section with descriptions
      content += `**${t('common.builtInCommands')}:**\n\n`;

      // List of built-in commands with descriptions
      const builtInCommandsWithDescriptions = [
        {
          command: '`/search`',
          description: t('common.searchDesc'),
        },
        {
          command: '`/close`',
          description: t('common.closeDesc'),
        },
        {
          command: '`/yes`, `/no`',
          description: t('common.confirmDesc'),
        },
        { command: '`/image`', description: t('common.imageDesc') },
        { command: '`/audio`', description: t('common.audioDesc') },
        { command: '`/create`', description: t('common.createDesc') },
        {
          command: '`/stop`, `/abort`',
          description: t('common.stopDesc'),
        },
        { command: '`/help`', description: t('common.helpDesc') },
      ];

      // Add built-in commands to content
      for (const cmd of builtInCommandsWithDescriptions) {
        content += `- ${cmd.command} - ${cmd.description}\n`;
      }

      // Add intent-based commands section
      content += `\n**${t('common.intentCommands')}:**\n\n`;
      content += `*${t('common.intentCommandsDesc')}*\n\n`;

      // List of intent-based commands with descriptions
      const intentCommands = [
        { command: 'move', description: t('common.moveDesc') },
        { command: 'copy', description: t('common.copyDesc') },
        { command: 'delete', description: t('common.deleteDesc') },
        { command: 'update', description: t('common.updateDesc') },
        { command: 'generate', description: t('common.generateDesc') },
        { command: 'read', description: t('common.readDesc') },
        { command: 'revert', description: t('common.revertDesc') },
        { command: 'thank_you', description: t('common.thankDesc') },
      ];

      // Add intent commands to content
      for (const cmd of intentCommands) {
        content += `- \`${cmd.command}\` - ${cmd.description}\n`;
      }

      // Add user-defined commands section if any exist
      const userDefinedCommands = this.plugin.userDefinedCommandService.userDefinedCommands;
      content += `\n**${t('common.userDefinedCommands')}:**\n\n`;
      if (userDefinedCommands.size > 0) {
        // Convert Map to array
        const sortedCommands = Array.from(userDefinedCommands.entries());

        for (const [cmdName, cmdDef] of sortedCommands) {
          const file = this.app.vault.getAbstractFileByPath(cmdDef.file_path);
          const fileName = file instanceof TFile ? file.basename : cmdDef.file_path;

          content += `- \`/${cmdName}\` - [[${cmdDef.file_path}|${fileName}]]\n`;
        }
      } else {
        content += `*${t('common.noUserDefinedCommands')}*\n\n`;
      }

      // Add help text
      content += `\n${t('common.commandHelpText')}\n`;

      // Update the conversation note with the commands list
      await this.renderer.updateConversationNote({
        path: title,
        newContent: content,
        role: 'Steward',
        includeHistory: false,
        command: 'help',
        lang,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      console.error('Error listing commands:', error);

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }
}
