import type StewardPlugin from 'src/main';
import { ToolName } from '../../ToolRegistry';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getShowWidgetThemeGuideline } from '../handlers/ShowWidget';

const VAULT_MANAGEMENT_TOOLS: ToolName[] = [
  ToolName.LIST,
  ToolName.CREATE,
  ToolName.DELETE,
  ToolName.COPY,
  ToolName.MOVE,
  ToolName.RENAME,
  ToolName.UPDATE_FRONTMATTER,
];

/**
 * Mixin: composes reusable prompt sections (task instructions, skill catalog)
 * that are shared across SuperAgent and SubAgent executors.
 */
export class SystemPromptComposer {
  protected buildTaskInstructions(availableTools: readonly ToolName[]): string {
    if (availableTools.length === 0) {
      return 'Your role is to assist using the tools provided below.';
    }
    if (availableTools.length === 1 && availableTools[0] === ToolName.SWITCH_AGENT_CAPACITY) {
      return `Your role is to help the user in direct-response mode. When they need vault tools, skills, or other agent capabilities, use ${ToolName.SWITCH_AGENT_CAPACITY} so they can confirm switching to full agent mode.`;
    }

    const available = new Set(availableTools);
    const mentioned = new Set<ToolName>();

    const lines: string[] = [
      'Your role is to help users with their Obsidian vault using the tools available in this conversation.',
    ];

    lines.push('- For generating tasks, you can generate directly.');

    const availableVaultTools = VAULT_MANAGEMENT_TOOLS.filter(t => available.has(t));
    if (availableVaultTools.length > 0) {
      for (const t of availableVaultTools) {
        mentioned.add(t);
      }
      lines.push(
        `- For vault management tasks, use the following tools: ${joinWithConjunction(availableVaultTools, 'and')}.`
      );
    }

    if (available.has(ToolName.LIST)) {
      lines.push(
        `- For past and current conversation notes, use ${ToolName.LIST} with folderPath set to "Steward/Conversations".`
      );
      mentioned.add(ToolName.LIST);
    }

    if (available.has(ToolName.CONTENT_READING)) {
      lines.push(
        `- For tasks that require domain-specific knowledge, use ${ToolName.CONTENT_READING} to read the skill file.`
      );
      mentioned.add(ToolName.CONTENT_READING);
    }

    if (available.has(ToolName.SHELL)) {
      lines.push(
        `- For hidden files or folders (dot-prefixed names), use ${ToolName.SHELL} from the vault root (e.g. cat, type, or Get-Content); other tools may not reach those paths.`
      );
      mentioned.add(ToolName.SHELL);
    }

    if (available.has(ToolName.SHOW_WIDGET)) {
      lines.push(
        `- For visual widgets, animations, or interactive demos, use ${ToolName.SHOW_WIDGET}. ${getShowWidgetThemeGuideline()}`
      );
      mentioned.add(ToolName.SHOW_WIDGET);
    }

    const hasUnmentioned = availableTools.some(t => !mentioned.has(t));
    if (hasUnmentioned) {
      lines.push('- For other tasks, use the appropriate tool(s).');
    }

    return lines.join('\n');
  }

  protected generateSkillCatalogPrompt(params: { plugin: StewardPlugin }): string {
    const catalog = params.plugin.skillService.getSkillCatalog();
    if (catalog.length === 0) {
      return '';
    }

    const entries = catalog
      .map(entry => `- ${entry.name}: ${entry.description} (path: ${entry.path})`)
      .join('\n');

    return `\n\nAVAILABLE SKILLS:
${entries}

When you need domain-specific knowledge for the task, use ${ToolName.CONTENT_READING} to read the skill file by path with readType: "entire".`;
  }

  protected generateUserDefinedCommandCatalogPrompt(params: {
    plugin: StewardPlugin;
    /** When false (e.g. subagent or narrowed tool set), show a placeholder instead of the catalog. */
    runCommandAvailable: boolean;
  }): string {
    const intro = `\n\nUSER-DEFINED COMMANDS:
User-defined commands combine skills, agents, automation, and workflows defined in markdown files under the ${params.plugin.settings.stewardFolder}/Commands folder.`;

    if (!params.runCommandAvailable) {
      return `${intro}

The command catalog is not listed here because ${ToolName.RUN_COMMAND} is inactive in this conversation. Activate ${ToolName.RUN_COMMAND} to load available commands in this section.`;
    }

    const catalog = params.plugin.userDefinedCommandService.getEnabledCommandCatalog();
    if (catalog.length === 0) {
      return '';
    }

    const entries = catalog
      .map(entry => {
        if (entry.description) {
          return `- ${entry.name}: ${entry.description} (path: ${entry.path})`;
        }
        return `- ${entry.name} (path: ${entry.path})`;
      })
      .join('\n');

    return `${intro}

Available commands:
${entries}

To run a user-defined command, use the ${ToolName.RUN_COMMAND} tool.
No need to read the command definition note before calling ${ToolName.RUN_COMMAND}, it's loaded automatically; pass command_name from this catalog.`;
  }
}
