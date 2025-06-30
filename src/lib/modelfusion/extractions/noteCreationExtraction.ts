import { generateObject } from 'ai';
import { noteCreationPrompt } from '../prompts/noteCreationPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { prepareUserMessage } from '../utils/userMessageUtils';
import { App } from 'obsidian';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from './intentExtraction';

const abortService = AbortService.getInstance();

export interface NoteDetails {
  noteName: string;
  content: string;
}

export interface NoteCreationExtraction {
  notes: NoteDetails[];
  explanation: string;
  confidence: number;
}

// Define the Zod schema for note creation extraction validation
const noteDetailsSchema = z.object({
  noteName: z.string().min(1, 'Note name must be a non-empty string'),
  content: z.string(),
});

const noteCreationExtractionSchema = z.object({
  notes: z.array(noteDetailsSchema).min(1, 'At least one note must be specified'),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1),
});

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
    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

    // Prepare user message with potential image content
    const userMessage = await prepareUserMessage(command.content, app);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('note-creation'),
      system: `${noteCreationPrompt.content}\n\n${userLanguagePromptText}`,
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
    console.error('Error extracting note creation details:', error);
    throw error;
  }
}
