import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultPart } from 'src/solutions/commands/tools/types';
import { measureSerializedOutputSize } from 'src/services/CompactionTokenService/compactors/outputMetrics';
import type { ToolCallContentReducer } from './types';

/** Serialized value at or under this size is left as-is — a placeholder would only grow it. */
const MIN_SERIALIZED_CHARS_BEFORE_REDUCTION = 200;

/**
 * No backing vault file (the result is unbounded widget/game state), so recall via message id is
 * the way back. Deterministic and static — no timestamps/random — so it never re-breaks the
 * prompt cache on repeated builds.
 */
function widgetQueryOmittedNotice(messageId: string): string {
  return (
    `Widget query result omitted to save tokens. Use ${ToolName.RECALL_COMPACTED_CONTEXT} ` +
    `with messageIds: ["msg-${messageId}"] to recall the full result if needed.`
  );
}

function isReducibleOutput(output: unknown): output is { type: 'json' | 'text'; value: unknown } {
  const type = (output as { type?: unknown } | null)?.type;
  return type === 'json' || type === 'text';
}

/**
 * Reduces `widget_query` tool results: replaces large output (unbounded board/game state JSON)
 * with a short placeholder. `error-*` outputs are left untouched.
 *
 * `widget_action` is intentionally not covered by a reducer — its output is `{ok,endTurn,message}`,
 * a few bytes, so the size guard here would no-op it anyway.
 */
export class WidgetQueryResultReducer implements ToolCallContentReducer {
  readonly toolName = ToolName.WIDGET_QUERY;

  reduceToolResult(params: {
    toolResult: ToolResultPart;
    messageId: string;
    lang?: string | null;
  }): ToolResultPart {
    const { toolResult, messageId } = params;
    const output = toolResult.output;

    if (!isReducibleOutput(output)) {
      return toolResult;
    }

    if (measureSerializedOutputSize(output.value) <= MIN_SERIALIZED_CHARS_BEFORE_REDUCTION) {
      return toolResult;
    }

    return {
      ...toolResult,
      output: {
        type: 'text',
        value: widgetQueryOmittedNotice(messageId),
      },
    };
  }
}
