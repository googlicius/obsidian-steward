import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';

interface ImageOutput {
  success?: boolean;
  filePath?: string;
}

/**
 * Compactor for image tool results.
 * Preserves the output path of the generated image artifact.
 */
export class ImageCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.IMAGE;

  compact(params: CompactorParams): CompactedToolResult {
    const output = params.output as ImageOutput | undefined;
    const outputPath = output?.filePath;
    return { toolName: this.toolName, metadata: { ...(outputPath && { outputPath }) } };
  }
}
