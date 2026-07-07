import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultPart } from 'src/solutions/commands/tools/types';
import type { ToolCallContentReducer } from './types';

/** Shell output at or under this many lines is left as-is; longer output gets a placeholder. */
const MAX_LINES_BEFORE_REDUCTION = 100;

/** No backing vault file (output lives in an archive note keyed by messageId), so recall via message id is the way back. */
function outputOmittedNotice(messageId: string, lineCount: number): string {
  return (
    `Shell output omitted to save tokens (${lineCount} lines). Use ${ToolName.RECALL_COMPACTED_CONTEXT} ` +
    `with messageIds: ["msg-${messageId}"] to recall the full output if needed.`
  );
}

function isTextOutput(output: unknown): output is { type: 'text'; value: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { type?: unknown }).type === 'text' &&
    typeof (output as { value?: unknown }).value === 'string'
  );
}

/**
 * Reduces `shell` tool results: replaces large output with a short placeholder. The tool-call
 * input (argsLine/purpose) is tiny and never reduced — only the result matters here. By the time
 * this runs, `deserializeToolInvocations` has already resolved the `headingRef:` pointer into the
 * actual archived shell output text (see ShellOutputArchiveService), so line count reflects what
 * the model would actually receive.
 */
export class ShellOutputContentReducer implements ToolCallContentReducer {
  readonly toolName = ToolName.SHELL;

  reduceToolResult(params: {
    toolResult: ToolResultPart;
    messageId: string;
    lang?: string | null;
  }): ToolResultPart {
    const { toolResult, messageId } = params;
    const output = toolResult.output;

    if (!isTextOutput(output)) {
      return toolResult;
    }

    const lineCount = output.value.split('\n').length;
    if (lineCount <= MAX_LINES_BEFORE_REDUCTION) {
      return toolResult;
    }

    return {
      ...toolResult,
      output: {
        ...output,
        value: outputOmittedNotice(messageId, lineCount),
      },
    };
  }
}
