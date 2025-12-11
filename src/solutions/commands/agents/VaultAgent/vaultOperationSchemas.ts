import { z } from 'zod';

/**
 * Creates an artifactId schema field for vault operations.
 */
export function createArtifactIdSchema(params: { description: string }) {
  return z.string().min(1).optional().describe(`${params.description}
- Use this when: 1. Provided (By user, tool call results), 2. The files is a part of a larger list.`);
}

/**
 * Creates a files schema field for vault operations with string paths.
 */
export function createFilesSchemaString(params: { description: string }) {
  return z
    .array(z.string().min(1))
    .optional()
    .refine(array => !array || array.length > 0, {
      message: 'files array must include at least one entry when provided.',
    }).describe(`${params.description}
DO NOT use this for a paginated list, where the files number is smaller than the total count.`);
}

/**
 * Creates a filePatterns schema field for vault operations.
 */
export function createFilePatternsSchema(params?: {
  description?: string;
  patternsDescription?: string;
}) {
  return z
    .object({
      patterns: z
        .array(z.string().min(1))
        .min(1)
        .describe(params?.patternsDescription ?? 'Array of RegExp patterns to match files.'),
      folder: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Optional folder path to limit pattern matching. If not provided, searches entire vault.'
        ),
    })
    .optional()
    .describe(
      params?.description ??
        'Pattern-based file selection for large file sets. Use this for large file sets to avoid token limits.'
    );
}

/**
 * Creates an explanation schema field for vault operations.
 */
export function createExplanationSchema(params: { description: string }) {
  return z.string().min(1).describe(params.description);
}
