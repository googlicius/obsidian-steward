import { tool } from 'ai';
import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ToolCallPart } from '../../tools/types';
import { GITHUB_WIKI_URL, WIKI_PAGES } from 'src/constants';

interface BuiltInCommand {
  command: string;
  description: string;
}

// HELP tool doesn't need args
const helpSchema = z.object({});

export type HelpArgs = z.infer<typeof helpSchema>;

export class Help {
  private static readonly helpTool = tool({
    inputSchema: helpSchema,
  });

  constructor(private readonly agent: AgentHandlerContext) {}

  public static getHelpTool() {
    return Help.helpTool;
  }

  /**
   * Handle help tool call
   * Lists all available built-in and user-defined commands
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<unknown> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('Help.handle invoked without handlerId');
    }

    try {
      // Format the commands list
      let content = '';

      // Add built-in commands section with descriptions
      content += `### ${t('common.builtInCommands')}\n\n`;

      // List of built-in commands with descriptions
      const builtInCommandsWithDescriptions: BuiltInCommand[] = [
        { command: '`/search`', description: t('common.searchDesc') },
        { command: '`/image`', description: t('common.imageDesc') },
        { command: '`/speech`', description: t('common.speechDesc') },
      ];

      // Add built-in commands to content
      for (const cmd of builtInCommandsWithDescriptions) {
        content += `- ${cmd.command} - ${cmd.description}\n`;
      }
      content += `\n*${t('common.builtInCommandsDesc')}*\n`;

      // Add user-defined commands section if any exist
      const userDefinedCommands = this.agent.plugin.userDefinedCommandService.userDefinedCommands;
      content += `\n### ${t('common.userDefinedCommands')}\n\n`;
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

      // Add skills section
      content += `\n### ${t('skills.skills')}\n\n`;

      // List loaded skills from the vault
      const loadedSkills = this.agent.plugin.skillService.getAllSkills();
      if (loadedSkills.length > 0) {
        for (const skill of loadedSkills) {
          const file = this.agent.app.vault.getFileByPath(skill.filePath);
          const fileName = file ? file.basename : skill.filePath;
          const disabledLabel = skill.enabled ? '' : ` ${t('common.disabledMark')}`;
          content += `- \`${skill.name}\`${disabledLabel} - [[${skill.filePath}|${fileName}]]\n`;
        }
      } else {
        content += `*${t('skills.noSkills')}*\n`;
      }

      // Add defined rules section
      content += `\n### ${t('guardrails.rules')}\n\n`;
      const rules = this.agent.plugin.guardrailsRuleService.getAllRules();
      if (rules.length > 0) {
        for (const rule of rules) {
          const file = this.agent.app.vault.getFileByPath(rule.path);
          if (file) {
            const disabledLabel = rule.enabled === false ? ` ${t('common.disabledMark')}` : '';
            content += `- \`${rule.name}\`${disabledLabel} - [[${file.basename}]]\n`;
          }
        }
      } else {
        content += `*${t('guardrails.noRulesDefined')}*\n`;
      }

      // Add tips section
      content += `\n### ${t('documentation.tips')}\n\n`;
      content += `- ${t('documentation.tipNewLines')}\n`;
      content += `- ${t('documentation.tipChangeModel')}\n`;
      content += `- ${t('documentation.tipAttachContext')}\n`;
      content += `- ${t('documentation.tipStop')}\n`;
      content += `- ${t('documentation.tipRevert')}\n`;

      // Add wiki links section
      content += `\n### ${t('documentation.guidelines')}\n\n`;
      content += `- [${t('documentation.getStartedGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.GET_STARTED})\n`;
      content += `- [${t('documentation.searchGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.SEARCH})\n`;
      content += `- [${t('documentation.udcGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.USER_DEFINED_COMMANDS})\n`;
      content += `- [${t('documentation.skillsGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.SKILLS})\n`;
      content += `- [${t('documentation.guardrailsGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.GUARDRAILS})\n`;

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
