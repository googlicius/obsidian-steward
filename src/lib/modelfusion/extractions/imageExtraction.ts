import { generateObject } from 'ai';
import { imageCommandPrompt } from '../prompts/imageCommandPrompt';
import { AbortService } from 'src/services/AbortService';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { logger } from 'src/utils/logger';
import { SystemPromptModifier } from 'src/solutions/commands';
import { Intent } from 'src/solutions/commands/types';

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
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

/**
 * Extract image generation details from a user query
 */
export async function extractImageQuery(
  intent: Intent
): Promise<z.infer<typeof imageExtractionSchema>> {
  const { systemPrompts = [] } = intent;

  // Extract only string-based system prompts (filter out modification objects)
  const modifier = new SystemPromptModifier(systemPrompts);
  const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: intent.model,
      generateType: 'object',
    });

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('image'),
      system: imageCommandPrompt,
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: intent.query,
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
