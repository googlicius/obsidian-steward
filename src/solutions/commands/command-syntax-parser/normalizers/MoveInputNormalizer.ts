import { ToolName } from '../../toolNames';
import type { InputNormalizer } from './InputNormalizer';

/**
 * Move tool expects: `{ operations: [{ mode, ... }], destinationFolder }`
 */
export class MoveInputNormalizer implements InputNormalizer {
  readonly toolName = ToolName.MOVE;

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    const destination = input.destinationFolder ?? '';

    if (input.artifactId) {
      return {
        operations: [{ mode: 'artifactId', artifactId: input.artifactId }],
        destinationFolder: destination,
      };
    }
    if (input.files) {
      return {
        operations: [{ mode: 'files', files: input.files }],
        destinationFolder: destination,
      };
    }
    return { operations: [], destinationFolder: destination };
  }
}
