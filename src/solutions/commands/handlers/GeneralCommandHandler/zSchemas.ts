import { z } from 'zod';
import { getValidCommandTypes } from 'src/lib/modelfusion/prompts/commands';
import { explanationFragment } from 'src/lib/modelfusion/prompts/fragments';

// Define valid command types
const validCommandTypes = getValidCommandTypes();

// Define the Zod schema for command type extraction
export const commandTypeExtractionSchema = z.object({
  commandTypes: z
    .array(z.enum(validCommandTypes as [string, ...string[]]))
    .max(20, 'Too many commands. Maximum allowed is 20.')
    .describe('An array of command types that should be executed in sequence.'),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1)
    .describe(`A confidence score from 0 to 1 for the overall sequence:
- 0.0-0.3: Low confidence (ambiguous or unclear requests)
- 0.4-0.7: Medium confidence (likely, but could be interpreted differently)
- 0.8-1.0: High confidence (very clear intent)
If the confidence is low, include the commands that you are extracting in the explanation so the user decides whether to proceed or not.`),
});

// Define the Zod schema for command intent
const commandIntentSchema = z.object({
  commandType: z
    .enum(validCommandTypes as [string, ...string[]])
    .describe(`One of the available command types.`),
  query: z.string().describe(
    `The specific query for this command and will be the input of the downstream command.
- Keep it concise and short
If the command is "read" or "create", then this is the original user's query.`
  ),
});

// Define the Zod schema for query extraction
export const queryExtractionSchema = z.object({
  commands: z.array(commandIntentSchema).max(20, 'Too many commands. Maximum allowed is 20.')
    .describe(`An array of objects, each containing commandType and query.
Each command in the sequence should have its own query that will be processed by specialized handlers.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  lang: z.string().nullable().optional(),
  queryTemplate: z
    .string()
    .optional()
    .describe(
      `A template version of the query where specific elements (tags, keywords, filenames, folders) are replaced with generic placeholders (x, y, z, f). This helps identify similar query patterns for caching purposes.`
    ),
});

// Export types
export type CommandTypeExtraction = z.infer<typeof commandTypeExtractionSchema>;
export type QueryExtraction = z.infer<typeof queryExtractionSchema>;
