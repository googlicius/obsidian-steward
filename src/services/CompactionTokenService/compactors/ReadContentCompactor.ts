import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import { truncatePathsWithNote } from './pathExtractor';

/**
 * Compactor for content_reading tool results.
 * Preserves paths of files that were read (distinct from edit/create).
 */
interface ReadContentOutput {
  artifactType: 'read_content';
  readingResults?: Array<{
    blocks: Array<{ startLine: number; endLine: number; content: string }>;
    source: string;
    elementType?: string;
    file?: { path: string; name: string };
  }>;
  imagePaths?: string[];
}

export class ReadContentCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.CONTENT_READING;

  compact(params: CompactorParams): CompactedToolResult {
    const output = params.output as ReadContentOutput | undefined;
    const results = output?.readingResults ?? [];

    const allPaths: string[] = [];
    const seenPaths = new Set<string>();

    for (const result of results) {
      if (!result.file || seenPaths.has(result.file.path)) continue;
      seenPaths.add(result.file.path);
      allPaths.push(result.file.path);
    }

    const { paths, note } = truncatePathsWithNote(allPaths);
    const files = paths.map(path => ({ path, name: path.split('/').pop() ?? path }));

    return {
      toolName: this.toolName,
      metadata: { files, ...(note && { note }) },
    };
  }
}
