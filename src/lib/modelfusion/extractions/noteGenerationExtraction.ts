import { generateObject } from 'ai';
import { noteGenerationPrompt } from '../prompts/noteGenerationPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

export interface NoteGenerationExtraction {
  noteName?: string;
  instructions: string;
  style?: string;
  explanation: string;
  confidence: number;
  modifiesNote: boolean;
}

// Define the Zod schema for note generation extraction validation
const noteGenerationExtractionSchema = z.object({
  noteName: z.string().optional(),
  instructions: z.string().min(1, 'Instructions must be a non-empty string'),
  style: z.string().optional(),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1),
  modifiesNote: z.boolean(),
});

/**
 * Extract note generation details from a user query
 * @param params Parameters for the note generation extraction
 * @returns Extracted note name, instructions, style preferences, and explanation
 */
export async function extractNoteGeneration(params: {
  userInput: string;
  systemPrompts?: string[];
  recentlyCreatedNote?: string;
}): Promise<NoteGenerationExtraction> {
  const { userInput, systemPrompts = [], recentlyCreatedNote } = params;

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig();

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('note-generation'),
      system: `${noteGenerationPrompt.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content: userInput },
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
