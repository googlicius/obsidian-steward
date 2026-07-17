import type { ToolCallPart, ToolResultPart } from 'src/solutions/commands/tools/types';
import type { ToolCallContentReducer } from './types';
import { CreateContentReducer } from './CreateContentReducer';
import { ShowWidgetContentReducer } from './ShowWidgetContentReducer';
import { ShellOutputContentReducer } from './ShellOutputContentReducer';
import { WidgetQueryResultReducer } from './WidgetQueryResultReducer';

export type { ToolCallContentReducer } from './types';

/** Registry of per-tool content reducers, mirroring CompactionTokenService's `compactors` map. */
export class ToolCallReducerRegistry {
  private readonly reducers = new Map<string, ToolCallContentReducer>();

  constructor() {
    for (const reducer of [
      new CreateContentReducer(),
      new ShowWidgetContentReducer(),
      new ShellOutputContentReducer(),
      new WidgetQueryResultReducer(),
    ]) {
      this.reducers.set(reducer.toolName, reducer);
    }
  }

  /** Reduces `toolCall` if a reducer registered for its tool name implements `reduceToolCall`; otherwise unchanged. */
  reduceToolCallIfRegistered(params: {
    toolCall: ToolCallPart;
    messageId: string;
    lang?: string | null;
  }): ToolCallPart {
    const reducer = this.reducers.get(params.toolCall.toolName);
    if (!reducer?.reduceToolCall) {
      return params.toolCall;
    }
    return reducer.reduceToolCall(params);
  }

  /** Reduces `toolResult` if a reducer registered for its tool name implements `reduceToolResult`; otherwise unchanged. */
  reduceToolResultIfRegistered(params: {
    toolResult: ToolResultPart;
    messageId: string;
    lang?: string | null;
  }): ToolResultPart {
    const reducer = this.reducers.get(params.toolResult.toolName);
    if (!reducer?.reduceToolResult) {
      return params.toolResult;
    }
    return reducer.reduceToolResult(params);
  }
}
