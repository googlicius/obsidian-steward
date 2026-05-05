import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';

/** Matches {@link shellToolInputSchema} in CliHandler. */
interface ShellToolInput {
  argsLine?: string;
}

/**
 * Compactor for shell tool invocations.
 * Preserves argsLine; output is replaced by a static recall hint.
 */
export class ShellCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.SHELL;

  compact(params: CompactorParams): CompactedToolResult {
    const input = params.toolCall.input as ShellToolInput | undefined;
    const argsLine = typeof input?.argsLine === 'string' ? input.argsLine : '';

    return {
      toolName: this.toolName,
      metadata: {
        argsLine,
        output: `Output omitted. Use ${ToolName.RECALL_COMPACTED_CONTEXT} to retrieve the full tool result.`,
      },
    };
  }
}
