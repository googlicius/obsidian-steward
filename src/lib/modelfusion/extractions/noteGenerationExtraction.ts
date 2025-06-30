import { generateObject } from 'ai';
import { noteGenerationPrompt } from '../prompts/noteGenerationPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { CommandIntent } from './intentExtraction';

const abortService = AbortService.getInstance();

export interface NoteGenerationExtraction {
  noteName?: string;
  instructions: string;
  style?: string;
  explanation: string;
  confidence: number;
  modifiesNote: boolean;
  lang?: string;
}

// Define the Zod schema for note generation extraction validation
const noteGenerationExtractionSchema = z.object({
  noteName: z.string().optional()
    .describe(`The note name/title from the user's request that they want to generate content into.
If the user wants to update or create content in a specific note, extract that note name.
If the user wants to create a user-defined or custom command, place the note in the Steward/Commands folder.
Leave noteName empty if the user provides a wikilink to a note ([[Link to a note]]) but does not explicitly want to update or create that note.`),
  instructions: z.string().min(1, 'Instructions must be a non-empty string')
    .describe(`The generation instructions from the user's request that will be fed to a sub-prompt for actual generating content.
The instructions should capture the user's intent (e.g., a request for generating or consulting, a question, etc.).`),
  style: z.string().optional().describe(`Optional style preferences for content generation.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  modifiesNote: z
    .boolean()
    .describe(
      `A boolean indicating if the user wants to create or update the noteName (true if yes, false if not).`
    ),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

/**
 * Extract note generation details from a user query
 * @param params Parameters for the note generation extraction
 * @returns Extracted note name, instructions, style preferences, and explanation
 */
export async function extractNoteGeneration(params: {
  command: CommandIntent;
  recentlyCreatedNote?: string;
}): Promise<NoteGenerationExtraction> {
  const { command, recentlyCreatedNote } = params;
  const { content, systemPrompts = [] } = command;

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('note-generation'),
      system: noteGenerationPrompt,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content },
      ],
      schema: noteGenerationExtractionSchema,
    });

    // If no note name is provided but there's a recently created note, use that
    if ((!object.noteName || object.noteName === '') && recentlyCreatedNote) {
      const result = {
        ...object,
        noteName: recentlyCreatedNote,
        explanation: `${object.explanation} Using the recently created note: ${recentlyCreatedNote}`,
      };
      return result;
    }

    return object;
  } catch (error) {
    console.error('Error extracting note generation details:', error);
    throw error;
  }
}
