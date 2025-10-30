import { generateObject } from 'ai';
import { destinationFolderPrompt } from '../prompts/destinationFolderPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from 'src/types/types';
import { confidenceFragment, explanationFragment } from '../prompts/fragments';
import { logger } from 'src/utils/logger';
import { SystemPromptModifier } from 'src/solutions/commands';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted destination folder parameters
 */
export interface DestinationFolderExtraction {
  destinationFolder: string;
  explanation: string;
  context: string;
  lang?: string | null;
}

export const desFolderExtractionSchema = z.object({
  destinationFolder: z
    .string()
    .min(1, 'Destination folder must be a non-empty string')
    .describe(
      `Where the notes should be moved or copied to.
Should be a path within the Obsidian vault.
Be precise about identifying the destination folder in the user's request.`
    )
    .transform(value => {
      // If the value are "root", ".", return the '/'
      if (value === 'root' || value === '.') {
        logger.warn(`Transforming the value "${value}" to "/".`);
        return '/';
      }
      return value;
    }),
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
    .nullable()
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
    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const modifier = new SystemPromptModifier(systemPrompts);
    const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('destination-folder'),
      system: modifier.apply(destinationFolderPrompt),
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: query,
        },
      ],
      schema: desFolderExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting destination folder:', error);
    throw error;
  }
}
