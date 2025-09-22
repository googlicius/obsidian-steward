import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { z } from 'zod';

// Define the Zod schema for content update
const contentUpdateSchema = z.object({
  updatedContent: z.string().describe(`Update exactly what was requested for the provided content.
Do not add any additional content or include any other text or formatting.`),
  originalContent: z.string().describe(`The original content of the element you are updating.
If the provided content contains multiple elements (e.g. mixed of paragraphs, lists, etc.), 
only include the original element you are updating.`),
});

// Define the Zod schema for content update extraction
export const contentUpdateExtractionSchema = z.object({
  updates: z
    .array(contentUpdateSchema)
    .describe(`An array of objects, each containing updatedContent and originalContent.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  notePath: z.string().optional().describe(`The path of the note that was updated if provided`),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

// Define the Zod schema for note generation extraction validation
export const noteGenerationExtractionSchema = z.object({
  noteName: z.string().nullable().optional()
    .describe(`The note name from the user's request that they want to generate content into.
Include only when:
- The user wants to update or create the <noteName> note.`),
  instructions: z.string().min(1, 'Instructions must be a non-empty string')
    .describe(`The generation instructions from the user's request that will be fed to a sub-prompt for actual generating content.
The instructions should capture the user's intent (e.g., a request for generating or consulting, a question, etc.).`),
  explanation: z.string().min(1, 'Explanation must be a non-empty string')
    .describe(`- Speak directly to the user (e.g., "I'll help you with...")
- No need the actual content, just say you will help the user with their query
- Keep it short`),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  modifiesNote: z
    .boolean()
    .describe(
      `A boolean indicating if the user wants to create or update the noteName (true if yes, false if not).`
    ),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type ContentUpdateExtraction = z.infer<typeof contentUpdateExtractionSchema>;
export type NoteGenerationExtraction = z.infer<typeof noteGenerationExtractionSchema>;
