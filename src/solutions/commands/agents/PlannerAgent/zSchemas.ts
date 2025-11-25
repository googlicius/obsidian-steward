import { z } from 'zod';
import { getValidCommandTypes } from 'src/lib/modelfusion/prompts/commands';
import { explanationFragment } from 'src/lib/modelfusion/prompts/fragments';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';

// Define valid command types
const validCommandTypes = getValidCommandTypes();

const validCommandTypeSet = new Set(validCommandTypes);
const isValidCommandTypeWithQuery = (value: string): boolean => {
  const [baseType] = value.split('?', 1);
  return validCommandTypeSet.has(baseType);
};

// Define the Zod schema for intent type extraction
export const intentTypeExtractionSchema = z.object({
  types: z
    .array(
      z
        .string()
        .min(1, 'Intent type must be a non-empty string.')
        .refine(isValidCommandTypeWithQuery, value => ({
          message: `Invalid intent type: ${value}.`,
        }))
    )
    .max(20, 'Too many intents. Maximum allowed is 20.')
    .describe('An array of intent types that should be executed in sequence.'),
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
const intentSchema = z.object({
  type: z
    .string()
    .min(1, 'Intent type must be a non-empty string.')
    .refine(isValidCommandTypeWithQuery, value => ({
      message: `Invalid intent type: ${value}.`,
    })),
  query: z.string().describe(
    `The specific query for this intent and will be the input of the downstream intent.
- Keep it concise and short
If the intent is "read" or "create", then this is the original user's query.`
  ),
});

// Define the Zod schema for query extraction
export const queryExtractionSchema = z.object({
  intents: z.array(intentSchema).max(20, 'Too many intents. Maximum allowed is 20.')
    .describe(`An array of objects, each containing intentType and query.
Each intent in the sequence should have its own query that will be processed by specialized handlers.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  lang: z.string().nullish().describe(userLanguagePrompt.content),
});

// Export types
export type IntentTypeExtraction = z.infer<typeof intentTypeExtractionSchema>;
export type QueryExtraction = z.infer<typeof queryExtractionSchema>;
