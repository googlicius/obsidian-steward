import { ToolRegistry, TOOL_DEFINITIONS, ToolName } from '../../ToolRegistry';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import type { SuperAgentCorePromptContext, SystemPromptBuilder } from './types';

const CATEGORY_LABEL: Record<string, string> = {
  'content-access': 'Reading note and media content',
  'user-interaction': 'User interaction and confirmations',
  'vault-access': 'Vault listing, search, and file operations',
  'content-edit': 'Editing existing content',
  'content-create': 'Creating new content',
  'artifact-access': 'Working with prior tool results (artifacts)',
  'content-generation': 'Speech, image, and generated media',
  'task-management': 'Task flow and completion signals',
  'tool-management': 'Activating optional tools and mode switching',
  orchestration: 'Delegating work to subagents',
  'context-retrieval': 'Recalling compacted conversation context',
  general: 'General tools',
};

/**
 * Builds system prompts for the SuperAgent.
 */
export class SuperAgentSystemPromptBuilder implements SystemPromptBuilder {
  public buildCorePrompt(context: SuperAgentCorePromptContext): string {
    const { registry, currentNote, currentPosition, todoListPrompt, skillCatalogPrompt } = context;

    const taskSection = this.buildTaskInstructionsFromRegistry(registry);

    return `You are a helpful assistant who helps users with their Obsidian vault.

${taskSection}

YOU HAVE ACCESS TO THE FOLLOWING TOOLS:
${registry.generateToolsSection()}

OTHER TOOLS (Inactive, need activate before using them):
${registry.generateOtherToolsSection(
  'No other tools available.',
  new Set([ToolName.TODO_LIST_UPDATE, ToolName.SEARCH_MORE, ToolName.CONCLUDE])
)}

TOOLS GUIDELINES:
${registry.generateGuidelinesSection()}
${currentNote ? `\nCURRENT NOTE: ${currentNote} (Cursor position: ${currentPosition})` : ''}${todoListPrompt}${skillCatalogPrompt}

NOTE:
- DO NOT mention or explain the tools you use or activate to users. Only communicate the results or outcomes.
- Respect user's language or the language they specified. The lang property should be a valid language code: en, vi, etc.`;
  }

  private buildTaskInstructionsFromRegistry(registry: ToolRegistry<unknown>): string {
    const active = registry.listActiveToolNames();
    if (active.length === 0) {
      return 'Your role is to assist using the tools provided below.';
    }
    if (active.length === 1 && active[0] === ToolName.SWITCH_AGENT_CAPACITY) {
      return `Your role is to help the user in direct-response mode. When they need vault tools, skills, or other agent capabilities, use ${ToolName.SWITCH_AGENT_CAPACITY} so they can confirm switching to full agent mode.`;
    }

    const byCategory = new Map<string, ToolName[]>();
    for (let i = 0; i < active.length; i++) {
      const name = active[i];
      const meta = TOOL_DEFINITIONS[name];
      const category = meta?.category ?? 'general';
      const bucket = byCategory.get(category);
      if (bucket) {
        bucket.push(name);
      } else {
        byCategory.set(category, [name]);
      }
    }

    const lines: string[] = [
      'Your role is to help users with their Obsidian vault using the tools available in this conversation.',
      'Apply tools by area:',
    ];
    for (const [category, toolsInCat] of byCategory) {
      const label = CATEGORY_LABEL[category] ?? category;
      lines.push(`- ${label}: ${joinWithConjunction(toolsInCat, 'and')}.`);
    }

    if (!active.includes(ToolName.EDIT) && !active.includes(ToolName.CREATE) && active.length > 2) {
      lines.push(
        '- When no available tool is needed, answer directly in your message (generation and explanation without file changes).'
      );
    }

    return lines.join('\n');
  }
}
