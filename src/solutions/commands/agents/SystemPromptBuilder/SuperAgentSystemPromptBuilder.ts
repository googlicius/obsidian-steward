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
- For editing tasks, use ${ToolName.EDIT}.
- For vault management tasks, use the following tools: ${joinWithConjunction(
      [
        ToolName.LIST,
        ToolName.CREATE,
        ToolName.DELETE,
        ToolName.COPY,
        ToolName.MOVE,
        ToolName.RENAME,
        ToolName.UPDATE_FRONTMATTER,
        ToolName.EXISTS,
      ],
      'and'
    )}.
- Use ${ToolName.EXISTS} when you need to verify whether files or folders exist (without content search).
- For tasks that require domain-specific knowledge, use ${ToolName.CONTENT_READING} to read the relevant skill file by path with readType: "entire".
- For other tasks, use the appropriate tool(s).

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

  public buildDisabledToolsPrompt(): string {
    return `You are a helpful assistant who helps users with their Obsidian vault.

Tools are currently disabled for this conversation.
You can use exactly one tool to switch mode:
- ${ToolName.SWITCH_AGENT_CAPACITY}: switch to agent mode.

If the user asks for work that requires tools, call ${ToolName.SWITCH_AGENT_CAPACITY} first.
After the switch is confirmed, continue the task and use tools as needed.`;
  }
}
