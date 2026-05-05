import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import { truncatePathsWithNote } from './pathExtractor';

interface CreateOutput {
  createdPaths?: string[];
  createdFiles?: string[];
  errors?: string[];
}

/**
 * Compactor for create tool results.
 * Preserves paths of newly created files (distinct from read/edit).
 */
export class CreateCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.CREATE;

  compact(params: CompactorParams): CompactedToolResult {
    const output = params.output as CreateOutput | undefined;
    const allPaths = output?.createdPaths ?? output?.createdFiles ?? [];
    const { paths, note } = truncatePathsWithNote(allPaths);
    return {
      toolName: this.toolName,
      metadata: { createdPaths: paths, ...(note && { note }) },
    };
  }
}
