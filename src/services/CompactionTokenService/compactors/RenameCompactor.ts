import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import { extractRenamePairsFromText, truncateWithNote } from './pathExtractor';

/**
 * Compactor for rename tool results.
 * Preserves from→to mapping so the model knows what was renamed to what.
 */
export class RenameCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.RENAME;

  compact(params: CompactorParams): CompactedToolResult {
    const output = params.output;
    const text =
      typeof output === 'string'
        ? output
        : output && typeof output === 'object' && 'value' in output
          ? String((output as { value: unknown }).value)
          : '';
    const allPairs = extractRenamePairsFromText(text);
    const { items, note } = truncateWithNote(allPairs);
    return {
      toolName: this.toolName,
      metadata: { renamed: items, ...(note && { note }) },
    };
  }
}
