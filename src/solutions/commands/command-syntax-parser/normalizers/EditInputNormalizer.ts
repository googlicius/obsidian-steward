import type { InputNormalizer } from './InputNormalizer';

/**
 * Edit tool expects: `{ operations: [{ mode, path, content, ... }], explanation }`
 */
export class EditInputNormalizer implements InputNormalizer {
  readonly toolName = 'edit';

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    const explanation = (input.explanation as string) || 'Command syntax edit';
    const operation: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (key === 'explanation') {
        continue;
      }
      operation[key] = value;
    }

    return {
      operations: [operation],
      explanation,
    };
  }
}
