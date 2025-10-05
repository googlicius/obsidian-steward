import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { z } from 'zod';
import { ArtifactType } from 'src/solutions/artifact';

// Define the Zod schema for content update
const contentUpdateSchema = z.object({
  updatedContent: z.string().describe(`Update exactly what was requested for the provided content.
Do not add any additional content or include any other text or formatting.`),
  fromLine: z
    .number()
    .describe(`The starting line number (0-based) of the original content to be replaced.`),
  toLine: z
    .number()
    .describe(`The ending line number (0-based) of the original content to be replaced.`),
});

// Define the Zod schema for update content tool
export const updateContentSchema = z.object({
  updates: z.array(contentUpdateSchema)
    .describe(`An array of objects, each containing updatedContent and line numbers (fromLine, toLine). 
Identify the exact content to update and provide the updated version while preserving the overall structure.
Get the line numbers from the ${ArtifactType.READ_CONTENT} artifact or grep's result that contains the content you're updating.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(`${explanationFragment} Clearly explain what changes you're making to the content.`),
  notePath: z
    .string()
    .optional()
    .describe(
      `The path of the note that was updated if provided. Include this when updating a specific note.`
    ),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

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

export type UpdateContentArgs = z.infer<typeof updateContentSchema>;
export type GenerateContentArgs = z.infer<typeof generateContentSchema>;
export type FileIncludingArgs = z.infer<typeof fileIncludingSchema>;
