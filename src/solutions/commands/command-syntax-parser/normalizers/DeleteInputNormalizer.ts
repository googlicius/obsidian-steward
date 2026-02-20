import { ToolName } from '../../toolNames';
import type { InputNormalizer } from './InputNormalizer';

/**
 * Delete tool expects: `{ operations: [{ mode, artifactId | files | filePatterns }] }`
 */
export class DeleteInputNormalizer implements InputNormalizer {
  readonly toolName = ToolName.DELETE;

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    if (input.artifactId) {
      return {
        operations: [{ mode: 'artifactId', artifactId: input.artifactId }],
      };
    }
    if (input.files) {
      return {
        operations: [{ mode: 'files', files: input.files }],
      };
    }
    return { operations: [] };
  }
}
