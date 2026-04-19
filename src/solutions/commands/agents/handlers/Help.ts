import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
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

/** Normalizes cell text; pipes stay literal so `[[path|alias]]` wikilinks work in Obsidian tables. */
function normalizeMarkdownTableCell(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push(`| ${headers.map(normalizeMarkdownTableCell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push(`| ${row.map(normalizeMarkdownTableCell).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function wikilinkInTable(path: string, displayName: string): string {
  return `[[${path}\\|${displayName}]]`;
}

export class Help {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getHelpTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: helpSchema,
    });
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
      let content = '';

      content += `### ${t('common.builtInCommands')}\n\n`;

      const builtInCommandsWithDescriptions: BuiltInCommand[] = [
        { command: '`/search`', description: t('common.searchDesc') },
        { command: '`/image`', description: t('common.imageDesc') },
        { command: '`/speech`', description: t('common.speechDesc') },
        { command: '`/>`', description: t('common.terminalDesc') },
      ];

      const builtInRows: string[][] = [];
      for (let i = 0; i < builtInCommandsWithDescriptions.length; i++) {
        const cmd = builtInCommandsWithDescriptions[i];
        builtInRows.push([cmd.command, cmd.description]);
      }
      content += formatMarkdownTable(
        [t('common.helpTableCommand'), t('common.helpTableDescription')],
        builtInRows
      );
      content += `\n*${t('common.builtInCommandsDesc')}*\n`;

      const userDefinedCommands = this.agent.plugin.userDefinedCommandService.userDefinedCommands;
      content += `\n### ${t('common.userDefinedCommands')}\n\n`;
      if (userDefinedCommands.size > 0) {
        const sortedCommands = Array.from(userDefinedCommands.entries());
        const udcRows: string[][] = [];
        for (let i = 0; i < sortedCommands.length; i++) {
          const entry = sortedCommands[i];
          const cmdName = entry[0];
          const cmdDef = entry[1];
          const slash = cmdDef.isHidden() ? '' : '/';
          const noteLink = wikilinkInTable(cmdDef.normalized.file_path, 'Link');
          udcRows.push([`\`${slash}${cmdName}\``, noteLink]);
        }
        content += formatMarkdownTable(
          [t('common.helpTableCommand'), t('common.helpTableNote')],
          udcRows
        );
      } else {
        content += `*${t('common.noUserDefinedCommands')}*\n\n`;
      }

      content += `\n### ${t('skills.skills')}\n\n`;

      const loadedSkills = this.agent.plugin.skillService.getAllSkills();
      if (loadedSkills.length > 0) {
        const skillRows: string[][] = [];
        for (let i = 0; i < loadedSkills.length; i++) {
          const skill = loadedSkills[i];
          const noteLink = wikilinkInTable(skill.filePath, 'SKILL');
          const status = skill.enabled
            ? t('common.helpStatusEnabled')
            : t('common.helpStatusDisabled');
          skillRows.push([`\`${skill.name}\``, status, noteLink]);
        }
        content += formatMarkdownTable(
          [t('common.helpTableName'), t('common.helpTableStatus'), t('common.helpTableNote')],
          skillRows
        );
      } else {
        content += `*${t('skills.noSkills')}*\n`;
      }

      content += `\n### ${t('guardrails.rules')}\n\n`;
      const rules = this.agent.plugin.guardrailsRuleService.getAllRules();
      if (rules.length > 0) {
        const ruleRows: string[][] = [];
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i];
          const file = this.agent.app.vault.getFileByPath(rule.path);
          if (!file) {
            continue;
          }
          const noteLink = wikilinkInTable(rule.path, 'Link');
          const status =
            rule.enabled === false ? t('common.helpStatusDisabled') : t('common.helpStatusEnabled');
          ruleRows.push([`\`${rule.name}\``, status, noteLink]);
        }
        if (ruleRows.length > 0) {
          content += formatMarkdownTable(
            [t('common.helpTableName'), t('common.helpTableStatus'), t('common.helpTableNote')],
            ruleRows
          );
        } else {
          content += `*${t('guardrails.noRulesDefined')}*\n`;
        }
      } else {
        content += `*${t('guardrails.noRulesDefined')}*\n`;
      }

      content += `\n### ${t('mcp.helpSection')}\n\n`;
      const mcpDefinitions = this.agent.plugin.mcpService.getAllDefinitions();
      if (mcpDefinitions.length > 0) {
        const mcpRows: string[][] = [];
        for (let i = 0; i < mcpDefinitions.length; i++) {
          const def = mcpDefinitions[i];
          const status = def.enabled
            ? t('common.helpStatusEnabled')
            : t('common.helpStatusDisabled');
          const noteLink = wikilinkInTable(def.path, t('mcp.helpNoteAlias'));
          mcpRows.push([`\`${def.name}\``, `\`${def.serverId}\``, status, noteLink]);
        }
        content += formatMarkdownTable(
          [
            t('common.helpTableName'),
            t('common.helpTableServerId'),
            t('common.helpTableStatus'),
            t('common.helpTableNote'),
          ],
          mcpRows
        );
      } else {
        content += `*${t('mcp.noServers', { folder: this.agent.plugin.mcpService.mcpFolder })}*\n`;
      }

      content += `\n### ${t('documentation.tips')}\n\n`;
      content += `- ${t('documentation.tipNewLines')}\n`;
      content += `- ${t('documentation.tipChangeModel')}\n`;
      content += `- ${t('documentation.tipAttachContext')}\n`;
      content += `- ${t('documentation.tipStop')}\n`;
      content += `- ${t('documentation.tipRevert')}\n`;

      content += `\n### ${t('documentation.guidelines')}\n\n`;
      content += `- [${t('documentation.getStartedGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.GET_STARTED})\n`;
      content += `- [${t('documentation.searchGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.SEARCH})\n`;
      content += `- [${t('documentation.udcGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.USER_DEFINED_COMMANDS})\n`;
      content += `- [${t('documentation.skillsGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.SKILLS})\n`;
      content += `- [${t('documentation.guardrailsGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.GUARDRAILS})\n`;
      content += `- [${t('documentation.mcpGuideline')}](${GITHUB_WIKI_URL}/${WIKI_PAGES.MCP})\n`;

      content += `\n${t('common.commandHelpText')}\n`;

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
