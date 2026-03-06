import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';

interface SpeechOutput {
  success?: boolean;
  filePath?: string;
}

/**
 * Compactor for speech tool results.
 * Preserves the output path of the generated audio artifact.
 */
export class SpeechCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.SPEECH;

  compact(params: CompactorParams): CompactedToolResult {
    const output = params.output as SpeechOutput | undefined;
    const outputPath = output?.filePath;
    return { toolName: this.toolName, metadata: { ...(outputPath && { outputPath }) } };
  }
}
