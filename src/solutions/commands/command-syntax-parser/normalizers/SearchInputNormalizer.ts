import { ToolName } from '../../toolNames';
import type { InputNormalizer } from './InputNormalizer';

/**
 * Search tool expects: `{ operations: [{ keywords, filenames, folders, properties }], ... }`
 */
export class SearchInputNormalizer implements InputNormalizer {
  readonly toolName = ToolName.SEARCH;

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    const operation: Record<string, unknown> = {
      keywords: input.keywords ?? [],
      filenames: input.filenames ?? [],
      folders: input.folders ?? [],
      properties: input.properties ?? [],
    };

    return {
      operations: [operation],
      explanation: `Command syntax search`,
      confidence: (input.confidence as number) ?? 1,
    };
  }
}
