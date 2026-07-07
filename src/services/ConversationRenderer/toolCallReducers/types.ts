import type { ToolCallPart, ToolResultPart } from 'src/solutions/commands/tools/types';

/**
 * Reduces a tool invocation's heavy fields to a short placeholder for LLM history replay, once
 * the message's own prompt-cache freshness is judged stale (see `ConversationRenderer.isToolCallStale`).
 * Never mutates the conversation note itself — the note always keeps full-fidelity content;
 * only the in-memory `ModelMessage[]` built for the next LLM request is affected.
 *
 * A reducer implements whichever side actually carries heavy content for its tool: `create` and
 * `show_widget` reduce the tool-CALL input (the content is what the model wrote); `shell` reduces
 * the tool-RESULT output (the content is what the shell printed back). Implement only what's needed.
 */
export interface ToolCallContentReducer {
  readonly toolName: string;
  reduceToolCall?(params: {
    toolCall: ToolCallPart;
    messageId: string;
    lang?: string | null;
  }): ToolCallPart;
  reduceToolResult?(params: {
    toolResult: ToolResultPart;
    messageId: string;
    lang?: string | null;
  }): ToolResultPart;
}
