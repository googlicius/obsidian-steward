import { generateObject } from 'ai';
import { imageCommandPrompt } from '../prompts/imageCommandPrompt';
import { AbortService } from 'src/services/AbortService';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from 'src/types/types';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { logger } from 'src/utils/logger';

const abortService = AbortService.getInstance();

// Define the Zod schema for image extraction validation
const imageExtractionSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text prompt that describes the image to generate.`),
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
 * Extract image generation details from a user query
 * @param command CommandIntent containing the user's request
 * @returns Extracted image generation details
 */
export async function extractImageQuery(
  command: CommandIntent
): Promise<z.infer<typeof imageExtractionSchema>> {
  const { systemPrompts = [] } = command;
  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('image'),
      system: imageCommandPrompt,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: command.query,
        },
      ],
      schema: imageExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting image generation parameters:', error);
    throw error;
  }
}
