import { generateObject } from 'ai';
import { audioCommandPrompt } from '../prompts/audioCommandPrompt';
import { AbortService } from 'src/services/AbortService';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { getObsidianLanguage } from 'src/utils/getObsidianLanguage';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from 'src/types/types';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { logger } from 'src/utils/logger';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted audio generation details
 */
export interface AudioExtraction {
  text: string;
  model?: string;
  voice?: string;
  explanation: string;
  confidence?: number;
  lang?: string;
}

// Define the Zod schema for audio extraction validation
const audioExtractionSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text to convert to speech. Focus on the pronunciation not explanation.`),
  model: z
    .string()
    .optional()
    .describe(`One of "openai", "elevenlabs". The model to use for speech generation if specified`),
  voice: z
    .string()
    .optional()
    .describe(
      `The voice to use for speech generation if specified (e.g., "alloy", "echo", "fable", "onyx", "nova", "shimmer", etc.)`
    ),
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
 * Extract audio generation details from a user query
 * @param params Parameters for audio extraction
 * @returns Extracted audio generation details
 */
export async function extractAudioQuery(command: CommandIntent): Promise<AudioExtraction> {
  const { systemPrompts = [] } = command;

  try {
    // Check if input is wrapped in quotation marks for direct extraction
    const quotedRegex = /^["'](.+)["']$/;
    const match = command.query.trim().match(quotedRegex);

    if (match) {
      const content = match[1];

      return {
        text: content,
        explanation: `Generating audio with: "${content}"`,
        lang: getObsidianLanguage(),
        confidence: 1,
      };
    }

    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('audio'),
      system: audioCommandPrompt,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        {
          role: 'user',
          content: command.query,
        },
      ],
      schema: audioExtractionSchema,
    });

    return object;
  } catch (error) {
    logger.error('Error extracting audio generation parameters:', error);
    throw error;
  }
}
