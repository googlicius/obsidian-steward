import { ToolName } from '../../toolNames';
import type { InputNormalizer } from './InputNormalizer';

/**
 * Prefix used to mark an artifact reference inside the `fileNames` array.
 *
 * The ReadContent handler detects entries starting with this prefix and
 * resolves them to actual file names via the artifact manager.
 */
export const ARTIFACT_REF_PREFIX = 'artifact:';

/**
 * ReadContent normalizer – handles the `artifact` flag which is
 * exclusive to command syntax and has no corresponding schema field.
 *
 * When `--artifact=<id|latest>` is provided, the value is embedded
 * into `fileNames` as `"artifact:<value>"` so the ReadContent handler
 * can resolve the actual files at execution time.
 */
export class ReadContentInputNormalizer implements InputNormalizer {
  readonly toolName = ToolName.CONTENT_READING;

  normalize(input: Record<string, unknown>): Record<string, unknown> {
    const { artifact, ...rest } = input;
    if (!artifact) return rest;

    const existingFileNames = (rest.fileNames as string[]) ?? [];

    return {
      ...rest,
      fileNames: [`${ARTIFACT_REF_PREFIX}${artifact}`, ...existingFileNames],
    };
  }
}
