import { ToolName } from '../../toolNames';
import type { InputNormalizer } from './InputNormalizer';

/**
 * Conclude tool expects: `{ conclusion, parallelToolName, validation: { expectedArtifactType? } }`
 *
 * Wraps the flat `expectedArtifactType` into the nested `validation` object.
 */
export class ConcludeInputNormalizer implements InputNormalizer {
  readonly toolName = ToolName.CONCLUDE;

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    const validation: Record<string, unknown> = {};
    if (input.expectedArtifactType) {
      validation.expectedArtifactType = input.expectedArtifactType;
    }

    return {
      parallelToolName: input.parallelToolName ?? '',
      validation,
    };
  }
}
