import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import { extractPathsFromText, truncatePathsWithNote } from './pathExtractor';

/**
 * Compactor for edit tool results.
 * Preserves paths that were modified (edited) for semantic clarity.
 */
export class EditCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.EDIT;

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
      metadata: { editedPaths: paths, ...(note && { note }) },
    };
  }
}
