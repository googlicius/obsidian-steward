import { generateObject } from 'ai';
import { destinationFolderPrompt } from '../prompts/destinationFolderPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted move details
 */
export interface MoveExtraction {
  destinationFolder: string;
  explanation: string;
  context: string;
  confidence: number;
  lang?: string;
}

// Define the Zod schema for move extraction validation
const moveExtractionSchema = z.object({
  destinationFolder: z.string().min(1, 'Destination folder must be a non-empty string'),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  context: z.string().min(1, 'Context must be a non-empty string'),
  confidence: z.number().min(0).max(1),
  lang: z.string().optional(),
});

/**
 * Extract move details from a user query
 * @param userInput Natural language request to move files
 * @param systemPrompts Optional system prompts to include
 * @returns Extracted move details
 */
export async function extractMoveQuery(
  userInput: string,
  systemPrompts: string[] = []
): Promise<MoveExtraction> {
  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig();

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('move'),
      system: `${destinationFolderPrompt.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: userInput,
        },
      ],
      schema: moveExtractionSchema,
    });

    return object;
  } catch (error) {
    console.error('Error extracting move from search result parameters:', error);
    throw error;
  }
}
