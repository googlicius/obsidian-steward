import { generateObject } from 'ai';
import { imageCommandPrompt } from '../prompts/imageCommandPrompt';
import { AbortService } from 'src/services/AbortService';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted image generation details
 */
// export interface ImageExtraction {
//   text: string;
//   size?: string;
//   quality?: string;
//   model?: string;
//   explanation: string;
//   confidence?: number;
//   lang?: string;
// }

// Define the Zod schema for image extraction validation
const imageExtractionSchema = z.object({
  text: z.string().min(1, 'Text must be a non-empty string'),
  size: z.string().optional(),
  quality: z.string().optional(),
  model: z.string().optional(),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1),
  lang: z.string().optional(),
});

/**
 * Extract image generation details from a user query
 * @param userInput Natural language request for image generation
 * @param systemPrompts Optional system prompts to include
 * @returns Extracted image generation details
 */
export async function extractImageQuery(
  userInput: string,
  systemPrompts: string[] = []
): Promise<z.infer<typeof imageExtractionSchema>> {
  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig();

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('image'),
      system: `${imageCommandPrompt.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: userInput,
        },
      ],
      schema: imageExtractionSchema,
    });

    return object;
  } catch (error) {
    console.error('Error extracting image generation parameters:', error);
    throw error;
  }
}
