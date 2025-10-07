import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { z } from 'zod';

// Define the Zod schema for generate content tool
export const generateContentSchema = z.object({
  noteName: z.string().nullable().optional()
    .describe(`The note name from the user's request that they want to generate content into.
Include only when:
- The user wants to update or create the <noteName> note.
- If the user specifies a note name, include it exactly as provided.`),
  explanation: z.string().min(1, 'Explanation must be a non-empty string')
    .describe(`- Speak directly to the user (e.g., "I'll help you with..."
- No need the actual content, just say you will help the user with their query
- Keep it short`),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  modifiesNote: z
    .boolean()
    .describe(
      `A boolean indicating if the user wants to create or update a specific note (true) or just wants a response in the conversation (false).`
    ),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export const fileIncludingSchema = z.object({
  filePath: z.string().describe(`The path of the file to read.`),
  explanation: z.string().describe(`A brief explanation of why reading this file is necessary.`),
});

export type GenerateContentArgs = z.infer<typeof generateContentSchema>;
export type FileIncludingArgs = z.infer<typeof fileIncludingSchema>;
