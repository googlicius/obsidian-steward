import { generateObject } from 'ai';
import { noteCreationPrompt } from '../prompts/noteCreationPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { prepareUserMessage } from '../utils/userMessageUtils';
import { App } from 'obsidian';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from 'src/types/types';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { logger } from 'src/utils/logger';

const abortService = AbortService.getInstance();

// Define the Zod schema for note creation extraction validation
const noteDetailsSchema = z.object({
  noteName: z.string().min(1, 'Note name must be a non-empty string')
    .describe(`The name/title for the note.
Use the specific name provided by the user.
If no name is provided but the user wants to create a note, generate a descriptive name based on the content.
Ensure the name is valid for a file system (no special characters).`),
  content: z.string().optional()
    .describe(`The user-provided content for the note (empty string if none provided).
If the user provides specific content, extract that content.
The content should be exactly what the user wants in the note.`),
});

const noteCreationExtractionSchema = z.object({
  notes: z.array(noteDetailsSchema).min(1, 'At least one note must be specified')
    .describe(`An array of objects, each containing noteName and content.
If the user only wants to create a single note, still return an array with one entry.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  lang: z.string().describe(userLanguagePrompt.content as string),
});

export type NoteCreationExtraction = z.infer<typeof noteCreationExtractionSchema>;

/**
 * Extract note creation details from a user query
 * @returns Extracted note details, explanation, and confidence
 */
export async function extractNoteCreation(params: {
  command: CommandIntent;
  app: App;
}): Promise<NoteCreationExtraction> {
  const { command, app } = params;

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    // Prepare user message with potential image content
    const userMessage = await prepareUserMessage(command.query, app);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('note-creation'),
      system: noteCreationPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
      schema: noteCreationExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting note creation details:', error);
    throw error;
  }
}
