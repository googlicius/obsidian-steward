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
