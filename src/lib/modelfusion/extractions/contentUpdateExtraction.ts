import { generateObject } from 'ai';
import { contentUpdatePrompt } from '../prompts/contentUpdatePrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';
import { prepareUserMessage } from '../utils/userMessageUtils';
import { App } from 'obsidian';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

export interface ContentUpdate {
  updatedContent: string;
  originalContent: string;
}

export interface ContentUpdateExtraction {
  updates: ContentUpdate[];
  explanation: string;
  confidence: number;
}

// Define the Zod schema for content update
const contentUpdateSchema = z.object({
  updatedContent: z.string(),
  originalContent: z.string(),
});

// Define the Zod schema for content update extraction
const contentUpdateExtractionSchema = z.object({
  updates: z.array(contentUpdateSchema),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1),
});

/**
 * Extract content update details from a user query
 * @param params Parameters for content update extraction
 * @returns Extracted updated contents, explanation, and confidence
 */
export async function extractContentUpdate(params: {
  userInput: string;
  systemPrompts?: string[];
  app: App;
  llmConfig?: any; // Keep for backward compatibility
}): Promise<ContentUpdateExtraction> {
  const { userInput, systemPrompts = [], app } = params;

  try {
    logger.log('Extracting content update from user input');

    const llmConfig = await LLMService.getInstance().getLLMConfig();

    const userMessage = await prepareUserMessage(userInput, app);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('content-update'),
      system: `${contentUpdatePrompt.content}\n\n${userLanguagePromptText.content}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: userMessage,
        },
      ],
      schema: contentUpdateExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting content update details:', error);
    throw error;
  }
}
