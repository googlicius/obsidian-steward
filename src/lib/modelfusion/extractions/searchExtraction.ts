import { generateObject } from 'ai';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { searchPromptV2 } from '../prompts/searchPromptV2';
import { getObsidianLanguage } from 'src/utils/getObsidianLanguage';
import { logger } from 'src/utils/logger';
import { getTranslation } from 'src/i18n';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from './intentExtraction';
import { explanationFragment } from '../prompts/fragments';

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
  keywords: z.array(z.string()).describe(`General terms or concepts to search for in file content.
If a term or phrase is wrapped in quotation marks (e.g., "cat or dog"),
preserve the quotes exactly as is for exact match queries.
  `),
  tags: z
    .array(z.string())
    .describe(`Obsidian tags that identify files (formatted without the # symbol)`),
  filenames: z
    .array(z.string())
    .describe(`Specific file names to search for (without .md extension)`),
  folders: z.array(z.string()).describe(`Specific folder paths to search within.
Use regex to represent user-specified exact (^folder$), start with (^folder), or contain (folder).
If the user wants to search in the root folder, use ^/$`),
});

// Define the Zod schema for search query extraction validation
const searchQueryExtractionSchema = z.object({
  operations: z.array(searchOperationSchema).describe(`An array of search operations.
If the user wants to search with different criteria in different locations, return multiple operations.
  `),
  explanation: z
    .string()
    .min(1, 'Explanation must be a non-empty string')
    .describe(explanationFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(`A number from 0 to 1 indicating confidence in this interpretation`),
});

/**
 * Extract search parameters from a natural language request using AI (v2)
 * @returns Extracted search parameters and explanation
 */
export async function extractSearchQueryV2({
  command,
  lang,
}: {
  command: CommandIntent;
  lang?: string;
}): Promise<SearchQueryExtractionV2> {
  const { systemPrompts = [] } = command;
  // Check if input is wrapped in quotation marks for direct search
  const quotedRegex = /^["'](.+)["']$/;
  const match = command.query.trim().match(quotedRegex);

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
  const trimmedInput = command.query.trim();
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
    const llmConfig = await LLMService.getInstance().getLLMConfig(command.model);

    // Use AI SDK to generate the response
    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('search-query-v2'),
      system: `${searchPromptV2.content}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content: command.query },
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
