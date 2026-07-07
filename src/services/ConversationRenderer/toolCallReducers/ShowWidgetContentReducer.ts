import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import type { ShowWidgetArgs } from 'src/solutions/commands/agents/handlers/ShowWidget';
import { isWidgetProjectInput } from 'src/solutions/commands/agents/handlers/ShowWidget';
import type { ToolCallContentReducer } from './types';

/**
 * Project-mode files are real vault files at the projectPath returned in this tool's own
 * (unreduced) tool-result, so content_reading/edit there recovers current — not stale — content.
 */
const PROJECT_OMITTED_NOTICE =
  `File content omitted to save tokens. The project files are on disk at the projectPath ` +
  `returned in this tool's result — use ${ToolName.CONTENT_READING} or ${ToolName.EDIT} there ` +
  `to inspect or change them.`;

/** Code-mode widgets have no backing vault file, so recall via message id is the only way back. */
function codeOmittedNotice(messageId: string): string {
  return (
    `Widget code omitted to save tokens. Use ${ToolName.RECALL_COMPACTED_CONTEXT} with ` +
    `messageIds: ["msg-${messageId}"] to recall the original code if needed.`
  );
}

/** Reduces `show_widget` tool calls: replaces code/file content with a short placeholder. */
export class ShowWidgetContentReducer implements ToolCallContentReducer {
  readonly toolName = ToolName.SHOW_WIDGET;

  reduceToolCall(params: {
    toolCall: ToolCallPart;
    messageId: string;
    lang?: string | null;
  }): ToolCallPart {
    const toolCall = params.toolCall as ToolCallPart<ShowWidgetArgs>;

    if (isWidgetProjectInput(toolCall.input)) {
      return {
        ...toolCall,
        input: {
          ...toolCall.input,
          files: (toolCall.input.files ?? []).map(file => ({
            ...file,
            content: PROJECT_OMITTED_NOTICE,
          })),
        },
      };
    }

    if (!toolCall.input.code) {
      return toolCall;
    }

    return {
      ...toolCall,
      input: {
        ...toolCall.input,
        code: codeOmittedNotice(params.messageId),
      },
    };
  }
}
