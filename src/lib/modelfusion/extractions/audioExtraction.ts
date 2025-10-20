import { generateObject } from 'ai';
import { audioCommandPrompt } from '../prompts/audioCommandPrompt';
import { AbortService } from 'src/services/AbortService';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from 'src/types/types';
import { explanationFragment, confidenceFragment } from '../prompts/fragments';
import { logger } from 'src/utils/logger';
import { getLanguage } from 'obsidian';
import { SystemPromptModifier } from 'src/utils/SystemPromptModifier';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted audio generation details
 */
export interface AudioExtraction {
  text: string;
  explanation: string;
  confidence?: number;
  lang?: string | null;
}

// Define the Zod schema for audio extraction validation
const audioExtractionSchema = z.object({
  text: z
    .string()
    .min(1, 'Text must be a non-empty string')
    .describe(`The text to convert to speech. Focus on the pronunciation not explanation.`),
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
 * Extract audio generation details from a user query
 * @param params Parameters for audio extraction
 * @returns Extracted audio generation details
 */
export async function extractAudioQuery(command: CommandIntent): Promise<AudioExtraction> {
  const { systemPrompts = [] } = command;

  // Extract only string-based system prompts (filter out modification objects)
  const modifier = new SystemPromptModifier(systemPrompts);
  const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

  try {
    // Check if input is wrapped in quotation marks for direct extraction
    const quotedRegex = /^["'](.+)["']$/;
    const match = command.query.trim().match(quotedRegex);

    if (match) {
      const content = match[1];

      return {
        text: content,
        explanation: `Generating audio with: "${content}"`,
        lang: getLanguage(),
        confidence: 1,
      };
    }

    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('audio'),
      system: audioCommandPrompt,
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
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
