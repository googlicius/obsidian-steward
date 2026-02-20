/**
 * Interface for input normalizers that transform flat parsed args
 * into the nested structure expected by each tool's schema.
 *
 * Follows the same pattern as {@link import('src/solutions/search/tokenizer/normalizers').Normalizer}
 */
export interface InputNormalizer {
  readonly toolName: string;
  normalize(input: Record<string, unknown>): Record<string, unknown>;
}
