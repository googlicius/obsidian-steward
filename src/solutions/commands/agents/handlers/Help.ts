import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';

// HELP tool doesn't need args
const helpSchema = z.object({});

export type HelpArgs = z.infer<typeof helpSchema>;

export class Help {
  private static readonly helpTool = tool({
    inputSchema: helpSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getHelpTool() {
    return Help.helpTool;
  }

  /**
   * Handle help tool call
   * Lists all available built-in and user-defined commands
   */
  public async handle(params: AgentHandlerParams): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('Help.handle invoked without handlerId');
    }

    try {
      // Format the commands list
      let content = `${t('common.availableCommands')}\n\n`;

      // Add built-in commands section with descriptions
      content += `**${t('common.builtInCommands')}:**\n\n`;
      content += `*${t('common.builtInCommandsDesc')}*\n\n`;

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
        { command: 'vault', description: t('common.vaultDesc') },
        { command: 'update', description: t('common.updateDesc') },
        { command: 'generate', description: t('common.generateDesc') },
        { command: 'read', description: t('common.readDesc') },
        { command: 'build_search_index', description: t('common.buildSearchIndexDesc') },
        {
          command: 'revert',
          description: t('common.revertDesc'),
        },
      ];

      // Add intent commands to content
      for (const cmd of intentCommands) {
        content += `- \`${cmd.command}\` - ${cmd.description}\n`;
      }

      // Add user-defined commands section if any exist
      const userDefinedCommands = this.agent.plugin.userDefinedCommandService.userDefinedCommands;
      content += `\n**${t('common.userDefinedCommands')}:**\n\n`;
      if (userDefinedCommands.size > 0) {
        // Convert Map to array
        const sortedCommands = Array.from(userDefinedCommands.entries());

        for (const [cmdName, cmdDef] of sortedCommands) {
          const file = this.agent.app.vault.getFileByPath(cmdDef.normalized.file_path);
          const fileName = file ? file.basename : cmdDef.normalized.file_path;
          const slash = cmdDef.isHidden() ? '' : '/';

          content += `- \`${slash}${cmdName}\` - [[${cmdDef.normalized.file_path}|${fileName}]]\n`;
        }
      } else {
        content += `*${t('common.noUserDefinedCommands')}*\n\n`;
      }

      // Add help text
      content += `\n${t('common.commandHelpText')}\n`;

      // Update the conversation note with the commands list
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: content,
        includeHistory: false,
        command: 'help',
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.STOP_PROCESSING,
      };
    } catch (error) {
      logger.error('Error listing commands:', error);

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }
}
