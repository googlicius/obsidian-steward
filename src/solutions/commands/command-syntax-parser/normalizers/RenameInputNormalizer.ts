import { ToolName } from '../../toolNames';
import type { InputNormalizer } from './InputNormalizer';

/**
 * Rename tool expects: `{ delegateToAgent: { artifactId, query } }`
 */
export class RenameInputNormalizer implements InputNormalizer {
  readonly toolName = ToolName.RENAME;

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    if (!input.artifactId && !input.query) {
      return input;
    }

    return {
      delegateToAgent: {
        artifactId: input.artifactId ?? '',
        query: input.query ?? '',
      },
    };
  }
}
