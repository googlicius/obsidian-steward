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
  size: z
    .string()
    .optional()
    .describe(`The image size in format "widthxheight" (e.g., "1024x1024", "512x512").`),
  quality: z.string().optional().describe(`The image quality ("standard" or "hd").`),
  model: z
    .string()
    .optional()
    .describe(`The model to use for generation (e.g., "dall-e-3", "dall-e-2").`),
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
    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

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
