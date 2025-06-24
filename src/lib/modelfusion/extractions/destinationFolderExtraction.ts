import { generateObject } from 'ai';
import { destinationFolderPrompt } from '../prompts/destinationFolderPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted destination folder parameters
 */
export interface DestinationFolderExtraction {
  destinationFolder: string;
  explanation: string;
  context: string;
  lang?: string;
}

// Define the Zod schema for destination folder extraction validation
const destinationFolderSchema = z.object({
  destinationFolder: z.string().min(1, 'Destination folder must be a non-empty string'),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  context: z.string().min(1, 'Context must be a non-empty string'),
  lang: z.string().optional(),
});

/**
 * Extract destination folder from a user query for moving or copying files
 * @param userInput Natural language request to move or copy files
 * @returns Extracted destination folder
 */
export async function extractDestinationFolder(
  userInput: string,
  systemPrompts: string[] = []
): Promise<DestinationFolderExtraction> {
  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig();

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('destination-folder'),
      system: `${destinationFolderPrompt.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: userInput,
        },
      ],
      schema: destinationFolderSchema,
    });

    return object;
  } catch (error) {
    console.error('Error extracting destination folder:', error);
    throw error;
  }
}
