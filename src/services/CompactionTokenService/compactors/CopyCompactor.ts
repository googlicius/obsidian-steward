import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import {
  extractPathsFromText,
  extractDestinationFromText,
  truncatePathsWithNote,
} from './pathExtractor';

/**
 * Compactor for copy tool results.
 * Preserves source paths of copied files and destination folder when extractable.
 */
export class CopyCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.COPY;

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
        sourcePaths: paths,
        ...(destination && { destination }),
        ...(note && { note }),
      },
    };
  }
}
