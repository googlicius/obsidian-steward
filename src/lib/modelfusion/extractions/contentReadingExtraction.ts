import { toolSystemPrompt } from '../prompts/contentReadingPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { generateText, tool } from 'ai';

const abortService = AbortService.getInstance();

export async function extractReadContent(userInput: string) {
  const llmConfig = await LLMService.getInstance().getLLMConfig();

  return generateText({
    ...llmConfig,
    abortSignal: abortService.createAbortController('content-reading'),
    system: `${toolSystemPrompt}\n\n${userLanguagePromptText.content}`,
    prompt: userInput,
    tools: {
      contentReading: tool({
        description: 'Read content partially.',
        parameters: z.object({
          readType: z.enum(['selected', 'above', 'below', 'entire']).default('above'),
          elementType: z.string().nullable().default(null),
          blocksToRead: z.number().min(-1).default(1),
          foundPlaceholder: z
            .string()
            .describe(
              'A short text to indicate that the content was found. Put {{number}} as the number of blocks found.'
            )
            .default(''),
          confidence: z.number().min(0).max(1).default(0.5),
          explanation: z.string(),
          lang: z
            .string()
            .optional()
            .describe('The lang property should be a valid language code: en, vi, etc.'),
        }),
      }),
    },
  });
}
