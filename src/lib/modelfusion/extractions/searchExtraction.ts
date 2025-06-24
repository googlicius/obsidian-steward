import { generateObject } from 'ai';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { searchPromptV2 } from '../prompts/searchPromptV2';
import { getObsidianLanguage } from 'src/utils/getObsidianLanguage';
import { logger } from 'src/utils/logger';
import { getTranslation } from 'src/i18n';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

/**
 * Represents a single search operation with v2 parameters
 */
export interface SearchOperationV2 {
  keywords: string[];
  tags: string[];
  filenames: string[];
  folders: string[];
}

/**
 * Represents the extracted search parameters from a natural language request (v2)
 */
export interface SearchQueryExtractionV2 {
  operations: SearchOperationV2[];
  explanation: string;
  lang?: string;
  confidence: number;
}

// Define the Zod schema for search operation validation
const searchOperationSchema = z.object({
  keywords: z.array(z.string()),
  tags: z.array(z.string()),
  filenames: z.array(z.string()),
  folders: z.array(z.string()),
});

// Define the Zod schema for search query extraction validation
const searchQueryExtractionSchema = z.object({
  operations: z.array(searchOperationSchema),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  lang: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

/**
 * Extract search parameters from a natural language request using AI (v2)
 * @param userInput Natural language request from the user
 * @param systemPrompts System prompts to add to the prompt
 * @param lang The language of the user
 * @returns Extracted search parameters and explanation
 */
export async function extractSearchQueryV2({
  userInput,
  systemPrompts = [],
  lang,
}: {
  userInput: string;
  systemPrompts?: string[];
  lang?: string;
}): Promise<SearchQueryExtractionV2> {
  // Check if input is wrapped in quotation marks for direct search
  const quotedRegex = /^["'](.+)["']$/;
  const match = userInput.trim().match(quotedRegex);

  const t = getTranslation(lang);

  if (match) {
    const searchTerm = match[1];
    return {
      operations: [
        {
          keywords: [`"${searchTerm}"`],
          tags: [],
          filenames: [],
          folders: [],
        },
        {
          keywords: [],
          tags: [],
          filenames: [searchTerm],
          folders: [],
        },
      ],
      explanation: t('search.searchingFor', { searchTerm }),
      lang: lang || getObsidianLanguage(),
      confidence: 1,
    };
  }

  // Check if input only contains tags
  const trimmedInput = userInput.trim();
  const tagRegex = /#([^\s#]+)/g;
  const tags = [...trimmedInput.matchAll(tagRegex)].map(match => match[1]);

  // If the input only contains tags (after removing tag patterns, only whitespace remains)
  if (tags.length > 0 && trimmedInput.replace(tagRegex, '').trim() === '') {
    return {
      operations: [
        {
          keywords: [],
          tags,
          filenames: [],
          folders: [],
        },
      ],
      explanation: t('search.searchingForTags', {
        tags: tags.map(tag => `#${tag}`).join(', '),
      }),
      lang: lang || getObsidianLanguage(),
      confidence: 1,
    };
  }

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig();

    // Use AI SDK to generate the response
    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('search-query-v2'),
      system: `${searchPromptV2.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content: userInput },
      ],
      schema: searchQueryExtractionSchema,
    });

    // Log any empty arrays in operations for debugging
    object.operations.forEach((op, index) => {
      if (
        op.keywords.length === 0 &&
        op.tags.length === 0 &&
        op.filenames.length === 0 &&
        op.folders.length === 0
      ) {
        logger.warn(`Operation ${index} has all empty arrays`);
      }
    });

    return {
      ...object,
      lang: object.lang || lang || getObsidianLanguage(),
    };
  } catch (error) {
    console.error('Error extracting search query:', error);
    throw error;
  }
}
