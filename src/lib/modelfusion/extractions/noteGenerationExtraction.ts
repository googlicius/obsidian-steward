import { generateObject } from 'ai';
import { noteGenerationPrompt } from '../prompts/noteGenerationPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { confidenceFragment } from '../prompts/fragments';
import { CommandIntent, ConversationHistoryMessage } from 'src/types/types';
import { logger } from 'src/utils/logger';

const abortService = AbortService.getInstance();

// Define the Zod schema for note generation extraction validation
const noteGenerationExtractionSchema = z.object({
  noteName: z.string().optional()
    .describe(`The note name from the user's request that they want to generate content into.
Include only when:
- The user wants to update or create the <noteName> note.`),
  instructions: z.string().min(1, 'Instructions must be a non-empty string')
    .describe(`The generation instructions from the user's request that will be fed to a sub-prompt for actual generating content.
The instructions should capture the user's intent (e.g., a request for generating or consulting, a question, etc.).`),
  style: z.string().optional().describe(`Optional style preferences for content generation.`),
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
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type NoteGenerationExtraction = z.infer<typeof noteGenerationExtractionSchema>;

/**
 * Extract note generation details from a user query
 * @param params Parameters for the note generation extraction
 * @returns Extracted note name, instructions, style preferences, and explanation
 */
export async function extractNoteGeneration(params: {
  command: CommandIntent;
  recentlyCreatedNote?: string;
  conversationHistory?: ConversationHistoryMessage[];
}): Promise<NoteGenerationExtraction> {
  const { command, recentlyCreatedNote, conversationHistory = [] } = params;
  const { systemPrompts = [] } = command;

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('note-generation'),
      system: noteGenerationPrompt(command),
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        ...conversationHistory.slice(0, -1),
        { role: 'user', content: command.query },
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
    logger.error('Error extracting note generation details:', error);
    throw error;
  }
}
