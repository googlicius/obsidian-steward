import type StewardPlugin from 'src/main';
import { ToolName } from '../../ToolRegistry';
import { joinWithConjunction } from 'src/utils/arrayUtils';

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
  protected buildTaskInstructionsFromAvailableTools(availableTools: readonly ToolName[]): string {
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

    if (available.has(ToolName.EDIT)) {
      lines.push(`- For editing tasks, use ${ToolName.EDIT} tool.`);
      mentioned.add(ToolName.EDIT);
    }

    const availableVaultTools = VAULT_MANAGEMENT_TOOLS.filter(t => available.has(t));
    if (availableVaultTools.length > 0) {
      for (const t of availableVaultTools) {
        mentioned.add(t);
      }
      lines.push(
        `- For vault management tasks, use the following tools: ${joinWithConjunction(availableVaultTools, 'and')}.`
      );
    }

    if (available.has(ToolName.CONTENT_READING)) {
      lines.push(
        `- For tasks that require domain-specific knowledge, use ${ToolName.CONTENT_READING} to read the skill file.`
      );
      mentioned.add(ToolName.CONTENT_READING);
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
}
