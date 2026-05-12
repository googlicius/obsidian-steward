import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import { extractPathsFromText, truncatePathsWithNote } from './pathExtractor';

/**
 * Compactor for delete tool results.
 * Preserves paths that were deleted (possibly trashed) so the model knows they are gone.
 */
export class DeleteCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.DELETE;

  compact(params: CompactorParams): CompactedToolResult {
    const output = params.output;
    const text =
      typeof output === 'string'
        ? output
        : output && typeof output === 'object' && 'value' in output
          ? String((output as { value: unknown }).value)
          : '';
    const allPaths = extractPathsFromText(text);
    const { paths, note } = truncatePathsWithNote(allPaths);
    return {
      toolName: this.toolName,
      metadata: { deletedPaths: paths, ...(note && { note }) },
    };
  }
}
