import { ToolCallPart as AI_ToolCallPart, ToolResultPart as AI_ToolResultPart } from 'ai';

export type ToolInvocation<T, ARGS = Record<string, unknown>> = {
  toolName: string;
  toolCallId: string;
  args: ARGS;
  result?: T;
};

export type ToolInvocationResult<T, ARGS = Record<string, unknown>> = {
  toolName: string;
  toolCallId: string;
  args: ARGS;
  result: T;
};

//-----------------
// AI SDK Version 5
//-----------------

export type ToolCallPart<INPUT = Record<string, unknown>> = AI_ToolCallPart & {
  input: INPUT;
};

export type ToolResultPart<OUTPUT = unknown> = AI_ToolResultPart & {
  output: OUTPUT;
};
