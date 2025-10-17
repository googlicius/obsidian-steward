import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { z } from 'zod';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { logger } from 'src/utils/logger';

export const contentReadingSchema = z.object({
  readType: z.enum(['above', 'below', 'entire']).default('above')
    .describe(`- "above", "below": Refers to the direction to read from current position.
- "entire": Refers to the entire content of the note.`),
  noteName: z
    .string()
    .nullable()
    .default(null)
    .describe(`Name of the note to read from. If not specified, leave it blank`)
    .transform(value => {
      if (value === null) return null;

      const normalizedValue = value.trim().toLowerCase();

      // Check if the value is a reference to the current note
      if (['current note', 'this note', 'current'].includes(normalizedValue)) {
        logger.warn(`noteName "${value}" refers to current note. Setting to null.`);
        return null;
      }

      return value;
    }),
  elementType: z
    .enum(['paragraph', 'table', 'code', 'list', 'blockquote', 'image', 'heading'])
    .nullable()
    .default(null)
    .describe(`Identify the element type if mentioned.`),
  blocksToRead: z.number().min(-1).default(1).describe(`Number of blocks to read
Set to -1 when:
- The user requests to read entire content.
- Reading above or below the cursor and explicitly requesting reading all content from the current position.`),
  startLine: z
    .number()
    .nullable()
    .default(null)
    .describe(
      `Specific line number to start reading from (0-based). Leave null to use cursor position.`
    ),
  foundPlaceholder: z
    .string()
    .optional()
    .nullable()
    .describe(
      `A short text to indicate that the content was found. MUST include the term {{number}} as a placeholder, for example: "I found {{number}}..."
If the readType is "entire", leave it null.`
    ),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  explanation: z.string().describe(explanationFragment),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type ContentReadingArgs = z.infer<typeof contentReadingSchema>;
