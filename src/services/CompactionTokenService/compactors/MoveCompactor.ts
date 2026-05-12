import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import {
  extractPathsFromText,
  extractDestinationFromText,
  truncatePathsWithNote,
} from './pathExtractor';

/**
 * Compactor for move tool results.
 * Preserves destination paths of moved files and destination folder when extractable.
 */
export class MoveCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.MOVE;

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
    const destination = extractDestinationFromText(text);
    return {
      toolName: this.toolName,
      metadata: {
        movedPaths: paths,
        ...(destination && { destination }),
        ...(note && { note }),
      },
    };
  }
}
