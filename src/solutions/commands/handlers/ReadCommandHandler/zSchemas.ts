import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { z } from 'zod';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';

export const contentReadingSchema = z.object({
  readType: z.enum(['above', 'below', 'entire']).default('above')
    .describe(`- "above": Refers to content above the cursor
- "below": Refers to content below the cursor
- "entire": Refers to the entire content of the note`),
  noteName: z
    .string()
    .nullable()
    .default(null)
    .describe(`Name of the note to read from. If not specified, leave it blank`),
  elementType: z.string().nullable().default(null).describe(`Identify element types if mentioned:
- One or many of "paragraph", "table", "code", "list", "blockquote", "image", or null if no specific element type is mentioned
- For multiple types:
  - Use comma-separated values for OR conditions (e.g., "paragraph, table")
  - Use "+" for AND conditions (e.g., "paragraph+table")`),
  blocksToRead: z.number().min(-1).default(1)
    .describe(`Number of blocks to read (paragraphs, tables, code blocks, etc.)
- Set to -1 ONLY if the user mentions "all content"
- Otherwise, extract the number from the query if specified`),
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
