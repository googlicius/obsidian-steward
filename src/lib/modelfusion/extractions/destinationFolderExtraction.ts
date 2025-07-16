import { generateObject } from 'ai';
import { destinationFolderPrompt } from '../prompts/destinationFolderPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from './intentExtraction';
import { confidenceFragment, explanationFragment } from '../prompts/fragments';

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

export const desFolderExtractionSchema = z.object({
  destinationFolder: z.string().min(1, 'Destination folder must be a non-empty string')
    .describe(`Where the notes should be moved or copied to.
Should be a path within the Obsidian vault.
Be precise about identifying the destination folder in the user's request.`),
  context: z.string().min(1, 'Context must be a non-empty string')
    .describe(`The origin of the notes.
One of "artifact", "currentNote", or "<a note name>".
If the user mentions "this note", use "currentNote".
If the user specifies a note name, use that note name.
Otherwise, use "artifact".`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

/**
 * Extract destination folder from a user query for moving or copying files
 * @returns Extracted destination folder
 */
export async function extractDestinationFolder(
  command: CommandIntent
): Promise<DestinationFolderExtraction> {
  const { query, systemPrompts = [] } = command;
  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('destination-folder'),
      system: `${destinationFolderPrompt}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: query,
        },
      ],
      schema: desFolderExtractionSchema,
    });

    return object;
  } catch (error) {
    console.error('Error extracting destination folder:', error);
    throw error;
  }
}
