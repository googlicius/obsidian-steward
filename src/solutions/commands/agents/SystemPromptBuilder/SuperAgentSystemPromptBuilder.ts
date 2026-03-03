import { ToolName } from '../../ToolRegistry';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import type { SuperAgentCorePromptContext, SystemPromptBuilder } from './types';

/**
 * Builds system prompts for the SuperAgent.
 */
export class SuperAgentSystemPromptBuilder implements SystemPromptBuilder {
  public buildCorePrompt(context: SuperAgentCorePromptContext): string {
    const { registry, currentNote, currentPosition, todoListPrompt, skillCatalogPrompt } = context;

    return `You are a helpful assistant who helps users with their Obsidian vault.

Your role is to help users with multiple tasks by using appropriate tools.
- For generating tasks, you can generate directly.
- For editing tasks, use ${ToolName.EDIT} tool.
- For vault management tasks, use the following tools: ${joinWithConjunction(
      [
        ToolName.LIST,
        ToolName.CREATE,
        ToolName.DELETE,
        ToolName.COPY,
        ToolName.MOVE,
        ToolName.RENAME,
        ToolName.UPDATE_FRONTMATTER,
      ],
      'and'
    )}.
- For tasks that require domain-specific knowledge, activate the relevant skill(s) first using ${ToolName.USE_SKILLS}.
- For other tasks, use the appropriate tool(s).

You have access to the following tools:
${registry.generateToolsSection()}

OTHER TOOLS (Inactive):
${registry.generateOtherToolsSection(
  'No other tools available.',
  new Set([
    ToolName.GREP,
    ToolName.LIST,
    ToolName.SEARCH,
    ToolName.IMAGE,
    ToolName.CONTENT_READING,
    ToolName.TODO_LIST,
  ]),
  new Set([ToolName.TODO_LIST_UPDATE, ToolName.SEARCH_MORE, ToolName.CONCLUDE])
)}

TOOLS GUIDELINES:
${registry.generateGuidelinesSection()}
${currentNote ? `\nCURRENT NOTE: ${currentNote} (Cursor position: ${currentPosition})` : ''}${todoListPrompt}${skillCatalogPrompt}

NOTE:
- Do NOT repeat the latest tool call result in your final response as it is already rendered in the UI.
- Do NOT mention the tools you use to users. Work silently in the background and only communicate the results or outcomes.
- Respect user's language or the language they specified. The lang property should be a valid language code: en, vi, etc.`;
  }

  public buildDisabledToolsPrompt(): string {
    return `You are a helpful assistant who helps users with their Obsidian vault.

Tools are currently disabled for this conversation.
You can use exactly one tool to switch mode:
- ${ToolName.SWITCH_AGENT_CAPACITY}: switch to agent mode.

If the user asks for work that requires tools, call ${ToolName.SWITCH_AGENT_CAPACITY} first.
After the switch is confirmed, continue the task and use tools as needed.`;
  }
}
