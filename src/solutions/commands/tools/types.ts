export type ToolInvocation<T> = {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: T;
};
