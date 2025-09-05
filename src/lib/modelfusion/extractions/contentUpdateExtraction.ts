import { generateObject } from 'ai';
import { contentUpdatePrompt } from '../prompts/contentUpdatePrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';
import { prepareMessage } from '../utils/messageUtils';
import { App } from 'obsidian';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { CommandIntent } from 'src/types/types';

const abortService = AbortService.getInstance();

export interface ContentUpdate {
  updatedContent: string;
  originalContent: string;
}

// Define the Zod schema for content update
const contentUpdateSchema = z.object({
  updatedContent: z.string().describe(`Update exactly what was requested for the provided content.
Do not add any additional content or include any other text or formatting.`),
  originalContent: z.string().describe(`The original content of the element you are updating.
If the provided content contains multiple elements (e.g. mixed of paragraphs, lists, etc.), 
only include the original element you are updating.`),
});

// Define the Zod schema for content update extraction
const contentUpdateExtractionSchema = z.object({
  updates: z
    .array(contentUpdateSchema)
    .describe(`An array of objects, each containing updatedContent and originalContent.`),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  notePath: z.string().optional().describe(`The path of the note that was updated if provided`),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type ContentUpdateExtraction = z.infer<typeof contentUpdateExtractionSchema>;

/**
 * Extract content update details from a user query
 * @param params Parameters for content update extraction
 * @returns Extracted updated contents, explanation, and confidence
 */
export async function extractContentUpdate(params: {
  command: CommandIntent;
  app: App;
}): Promise<ContentUpdateExtraction> {
  const { command, app } = params;

  try {
    logger.log('Extracting content update from user input');

    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const userMessage = await prepareMessage(command.query, app);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('content-update'),
      system: contentUpdatePrompt,
      messages: [
        ...(command.systemPrompts || []).map(prompt => ({
          role: 'system' as const,
          content: prompt,
        })),
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
