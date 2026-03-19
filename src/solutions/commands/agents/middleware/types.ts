import type { AgentHandlerParams, AgentResult } from '../../types';
import type { ToolCallPart } from '../../tools/types';
import type { ToolName } from '../../ToolRegistry';
import type { ToolContentStreamInfo } from '../components/ToolContentStreamConsumer';

export interface ToolHandlerMiddlewareContext {
  params: AgentHandlerParams;
  toolCall: ToolCallPart;
  toolContentStreamInfo?: ToolContentStreamInfo;
  /** Agent instance, used e.g. by guardrails to extract paths from handlers */
  agent?: { getPathsForGuardrails(toolName: ToolName, input: unknown): string[] };
}

export type ToolHandlerMiddleware = (
  ctx: ToolHandlerMiddlewareContext,
  next: () => Promise<AgentResult>
) => Promise<AgentResult>;
