import { toolSystemPrompt } from '../prompts/contentReadingPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { generateText, tool } from 'ai';
import { CommandIntent } from './intentExtraction';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';

const abortService = AbortService.getInstance();

const contentReadingSchema = z.object({
  readType: z.enum(['selected', 'above', 'below', 'entire']).default('above')
    .describe(`- "selected": Refers to "selected text" or "this text"
- "above": Refers to content above the cursor
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
- Set to -1 if the user mentions "all" content
- Otherwise, extract the number from the query if specified`),
  foundPlaceholder: z
    .string()
    .describe(
      'A short text to indicate that the content was found. Put {{number}} as the number of blocks found.'
    ),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  explanation: z.string().describe(explanationFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export async function extractReadContent(command: CommandIntent) {
  const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

  return generateText({
    ...llmConfig,
    abortSignal: abortService.createAbortController('content-reading'),
    system: toolSystemPrompt,
    prompt: command.query,
    tools: {
      contentReading: tool({
        parameters: contentReadingSchema,

        // execute: async args => {
        //   const readingResult = await ContentReadingService.getInstance().readContent(args);
        //   if (!readingResult) {
        //     return null;
        //   }
        //   return {
        //     blocks: readingResult.blocks,
        //     elementType: readingResult.elementType,
        //     range: readingResult.range,
        //   };
        // },
      }),
    },
  });
}
