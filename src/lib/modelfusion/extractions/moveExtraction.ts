import { generateObject } from 'ai';
import { destinationFolderPrompt } from '../prompts/destinationFolderPrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { desFolderExtractionSchema } from './destinationFolderExtraction';
import { logger } from 'src/utils/logger';
import { CommandIntent } from 'src/types/types';
import { SystemPromptModifier } from 'src/solutions/commands';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted move details
 */
export interface MoveExtraction {
  destinationFolder: string;
  explanation: string;
  context: string;
  confidence: number;
  lang?: string | null;
}

/**
 * Extract move details from a user query
 * @returns Extracted move details
 */
export async function extractMoveQuery(command: CommandIntent): Promise<MoveExtraction> {
  const { systemPrompts = [] } = command;

  // Extract only string-based system prompts (filter out modification objects)
  const modifier = new SystemPromptModifier(systemPrompts);
  const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('move'),
      system: destinationFolderPrompt,
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: command.query,
        },
      ],
      schema: desFolderExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting move from search result parameters:', error);
    throw error;
  }
}
