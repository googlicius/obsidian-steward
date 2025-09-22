import { generateObject } from 'ai';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { searchPromptV2 } from '../prompts/searchPromptV2';
import { getObsidianLanguage } from 'src/utils/getObsidianLanguage';
import { logger } from 'src/utils/logger';
import { getTranslation } from 'src/i18n';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';
import { CommandIntent } from 'src/types/types';
import { explanationFragment } from '../prompts/fragments';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { StewardPluginSettings } from 'src/types/interfaces';
import { DEFAULT_SETTINGS } from 'src/constants';

const abortService = AbortService.getInstance();

/**
 * Represents a single search operation with v2 parameters
 */
export interface SearchOperationV2 {
  keywords: string[];
  filenames: string[];
  folders: string[];
  properties: Array<{ name: string; value: string }>;
}

/**
 * Represents the extracted search parameters from a natural language request (v2)
 */
export interface SearchQueryExtractionV2 {
  operations: SearchOperationV2[];
  explanation: string;
  lang?: string;
  confidence: number;
  needsLLM: boolean;
}

// Define the Zod schema for search operation validation
const searchOperationSchema = z.object({
  keywords: z.array(z.string()).describe(`General terms or concepts to search for in file content.
If a term or phrase is wrapped in quotation marks (e.g., "cat or dog"),
preserve the quotes exactly as is for exact match queries.`),
  filenames: z.array(z.string()).describe(`Specific file names to search for (without .md extension)
- Includes only when the user explicitly mentions a file name or note name`),
  folders: z.array(z.string()).describe(`Specific folder paths to search within
- If the user wants to search in the root folder, use ^/$`),
  properties: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    })
  ).describe(`Properties to search for in files:
- For tags: use name: "tag" and value without # symbol
- For file types: use name: "file_type" and value: extension (e.g., "md", "pdf", "jpg")
- For file categories: use name: "file_category" and value: category (e.g., "document", "image", "audio", "video", "data", "code")
- For frontmatter properties: use the property name and value
Examples:
- For images: {name: "file_category", value: "image"}
- For PDFs: {name: "file_type", value: "pdf"}
- For notes: {name: "file_type", value: "md"}
- For documents with status "completed": {name: "status", value: "completed"}`),
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
  searchSettings = DEFAULT_SETTINGS.search,
}: {
  command: CommandIntent;
  searchSettings?: StewardPluginSettings['search'];
  lang?: string | null;
}): Promise<SearchQueryExtractionV2> {
  const { systemPrompts = [] } = command;
  const t = getTranslation(lang);

  // Check if input is wrapped in quotation marks for direct search
  const searchTerm = getQuotedQuery(command.query);

  if (searchTerm) {
    const operations: SearchOperationV2[] = [
      {
        keywords: [],
        filenames: [searchTerm],
        folders: [],
        properties: [],
      },
    ];

    if (searchSettings.withoutLLM === 'relevant') {
      operations.push({
        keywords: [searchTerm],
        filenames: [],
        folders: [],
        properties: [],
      });
    } else {
      operations.push({
        keywords: [`"${searchTerm}"`],
        filenames: [],
        folders: [],
        properties: [],
      });
    }
    return {
      operations,
      explanation: t('search.searchingFor', { searchTerm }),
      lang: lang || getObsidianLanguage(),
      confidence: 1,
      needsLLM: false,
    };
  }

  // Check if input only contains tags
  const trimmedInput = command.query.trim();
  const tagRegex = /#([^\s#]+)/g;
  const NON_TAG_PATTERN = '[,\\s;|&+]+$';
  const tags = [...trimmedInput.matchAll(tagRegex)].map(match =>
    match[1].replace(new RegExp(NON_TAG_PATTERN), '')
  );

  // If the input only contains tags (after removing tag patterns, only whitespace remains)
  if (tags.length > 0 && trimmedInput.replace(tagRegex, '').trim() === '') {
    return {
      operations: [
        {
          keywords: [],
          filenames: [],
          folders: [],
          properties: tags.map(tag => ({
            name: 'tag',
            value: tag,
          })),
        },
      ],
      explanation: t('search.searchingForTags', {
        tags: tags.map(tag => `#${tag}`).join(', '),
      }),
      lang: lang || getObsidianLanguage(),
      confidence: 1,
      needsLLM: false,
    };
  }

  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig({
      overrideModel: command.model,
      generateType: 'object',
    });

    // Use AI SDK to generate the response
    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('search-query-v2'),
      system: searchPromptV2(command),
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
        op.filenames.length === 0 &&
        op.folders.length === 0 &&
        op.properties.length === 0
      ) {
        logger.warn(`Operation ${index} has all empty arrays`);
      }
    });

    return {
      ...object,
      lang: object.lang || lang || getObsidianLanguage(),
      needsLLM: true,
    };
  } catch (error) {
    logger.error('Error extracting search query:', error);
    throw error;
  }
}
