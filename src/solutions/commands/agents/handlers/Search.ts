import { tool } from 'ai';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { PaginatedSearchResult } from 'src/solutions/search/types';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { STOPWORDS } from 'src/solutions/search';
import { stemmer } from 'src/solutions/search/tokenizer/stemmer';
import { z } from 'zod/v3';
import { explanationFragment } from 'src/lib/modelfusion/prompts/fragments';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { getLanguage } from 'obsidian';
import { DEFAULT_SETTINGS } from 'src/constants';
import { StewardPluginSettings } from 'src/types/interfaces';

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
export const searchQueryExtractionSchema = z.object({
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
  toolCall?: ToolCallPart<unknown>;
}

type HighlighKeywordResult = {
  highlightedText: string;
  lineNumber: number;
  termMatches: {
    term: string;
    start: number;
    end: number;
    match: string;
  }[];
};

export type SearchArgs = {
  operations: SearchOperationV2[];
  explanation: string;
  lang?: string;
  confidence: number;
};

export class Search {
  private static readonly searchTool = tool({
    inputSchema: searchQueryExtractionSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getSearchTool() {
    return Search.searchTool;
  }

  /**
   * Extract search query without LLM (pre-LLM logic)
   * This handles simple cases like quoted queries and tag-only queries
   * @returns SearchQueryExtractionV2 if extraction is possible without LLM, null otherwise
   */
  public extractSearchQueryWithoutLLM(args: {
    query: string;
    searchSettings?: StewardPluginSettings['search'];
    lang?: string | null;
  }): SearchQueryExtractionV2 | null {
    const { query, lang, searchSettings = DEFAULT_SETTINGS.search } = args;
    const t = getTranslation(lang);

    // Check if input is wrapped in quotation marks for direct search
    const searchTerm = getQuotedQuery(query);

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
        lang: lang || getLanguage(),
        confidence: 1,
        needsLLM: false,
      };
    }

    // Check if input only contains tags
    const trimmedInput = query.trim();
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
        lang: lang || getLanguage(),
        confidence: 1,
        needsLLM: false,
      };
    }

    // Cannot extract without LLM
    return null;
  }

  /**
   * Handle search tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<SearchArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId, nextIntent } = params;
    const { operations, explanation, lang: searchLang } = options.toolCall.input;
    const t = getTranslation(searchLang || lang);

    if (!handlerId) {
      throw new Error('Search.handle invoked without handlerId');
    }

    // Check if search index is built
    const isIndexBuilt = await this.agent.plugin.searchService.documentStore.isIndexBuilt();

    if (!isIndexBuilt) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent:
          t('search.indexNotBuilt') +
          '\n\n' +
          t('search.buildIndexFirst') +
          '\n\n' +
          `*${t('search.privacyNotice')}*`,
        lang: searchLang || lang,
        command: 'search',
        handlerId,
      });
      return {
        status: IntentResultStatus.ERROR,
        error: new Error('Search index not built'),
      };
    }

    // Check if there are multiple operations and we need confirmation
    if (operations.length > 1) {
      // Format the operations for display
      let message =
        t('search.multipleOperationsHeader', {
          count: operations.length,
        }) + '\n\n';

      for (let index = 0; index < operations.length; index++) {
        const operation = operations[index];
        message += `**${t('search.operation', { num: index + 1 })}**\n`;

        if (operation.keywords.length > 0) {
          message += `- ${t('search.keywords')}: ${operation.keywords.join(', ')}\n`;
        }

        if (operation.properties.length > 0) {
          message += `- ${t('search.properties')}: ${operation.properties.map(prop => `${prop.name}: ${prop.value}`).join(', ')}\n`;
        }

        if (operation.filenames.length > 0) {
          // Escape filenames as they contain some special characters
          const escapedFilenames = new MarkdownUtil(operation.filenames.join(', '))
            .escape()
            .getText();
          message += `- ${t('search.filenames')}: ${escapedFilenames}\n`;
        }

        if (operation.folders.length > 0) {
          // Escape folders as they contain some special characters
          const escapedFolders = new MarkdownUtil(operation.folders.join(', ')).escape().getText();
          message += `- ${t('search.folders')}: ${escapedFolders}\n`;
        }

        // Add an extra newline between operations except for the last one
        if (index < operations.length - 1) {
          message += '\n';
        }
      }

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        lang: searchLang || lang,
        command: 'search',
        includeHistory: false,
        handlerId,
      });

      // Check if the next command will operate on the search results
      if (nextIntent && nextIntent.type.endsWith('_from_artifact')) {
        // Request confirmation before proceeding
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('search.confirmMultipleOperations'),
          lang: searchLang || lang,
          command: 'search',
          handlerId,
        });

        return {
          status: IntentResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: async () => {
            return this.performSearch(
              title,
              operations,
              explanation,
              searchLang || lang,
              handlerId,
              options.toolCall
            );
          },
          onRejection: () => {
            return {
              status: IntentResultStatus.SUCCESS,
            };
          },
        };
      }
    }

    return this.performSearch(
      title,
      operations,
      explanation,
      searchLang || lang,
      handlerId,
      options.toolCall
    );
  }

  /**
   * Perform the actual search operation
   */
  private async performSearch(
    title: string,
    operations: SearchOperationV2[],
    explanation: string,
    lang: string | null | undefined,
    handlerId: string,
    toolCall: ToolCallPart<SearchArgs>
  ): Promise<AgentResult> {
    const t = getTranslation(lang);

    const queryResult = await this.agent.plugin.searchService.searchV3(operations);

    // Paginate the results for display (first page)
    const resultsPerPage = this.agent.plugin.settings.search.resultsPerPage;
    const paginatedSearchResult = this.agent.plugin.searchService.paginateResults(
      queryResult.conditionResults,
      1,
      resultsPerPage
    );

    const response = await this.formatSearchResults({
      paginatedSearchResult,
      headerText: explanation,
      lang,
    });

    // Update the conversation note, user only see the response
    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      lang,
      command: 'search',
      handlerId,
      includeHistory: false,
    });

    if (queryResult.conditionResults.length === 0) {
      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'search',
        handlerId,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: `messageRef:${messageId}`,
            },
          },
        ],
      });
    }

    // Store the search results in the artifact manager
    else {
      const artifactId = await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        text: `*${t('common.artifactCreated', {
          type: ArtifactType.SEARCH_RESULTS,
        })}*`,
        artifact: {
          artifactType: ArtifactType.SEARCH_RESULTS,
          originalResults: queryResult.conditionResults,
        },
      });

      const displayedCount = paginatedSearchResult.conditionResults.length;
      const totalCount = paginatedSearchResult.totalCount;
      const hasMoreResults = displayedCount < totalCount;
      const moreCount = hasMoreResults ? totalCount - displayedCount : 0;

      // Build file paths list
      const filePaths: string[] = [];
      for (let index = 0; index < displayedCount; index += 1) {
        const result = paginatedSearchResult.conditionResults[index];
        filePaths.push(result.document.path);
      }

      // Build result text similar to VaultList format
      let resultText = `${t('search.found', { count: totalCount })}\n\n${filePaths.join('\n')}`;

      if (moreCount > 0) {
        resultText += `\n\n${t('list.moreFiles', { count: moreCount })}`;
      }

      if (hasMoreResults) {
        resultText += `\n\n${t('list.fullListAvailableInArtifact', { artifactId })}`;
      }

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'search',
        handlerId,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: resultText,
            },
          },
        ],
      });
    }

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  /**
   * Format search results into a markdown string for display
   */
  public async formatSearchResults(options: {
    paginatedSearchResult: PaginatedSearchResult<IndexedDocument>;
    page?: number;
    headerText?: string;
    lang?: string | null;
  }): Promise<string> {
    const { paginatedSearchResult, headerText, lang } = options;
    const page = options.page || 1;

    // Get translation function using the provided language or default
    const t = getTranslation(lang);

    let response = '';

    // Add header text if provided
    if (headerText) {
      response += `${headerText}\n\n`;
    }

    // Add specific header based on page (first page vs pagination)
    if (page === 1) {
      // First page header (search results count)
      if (paginatedSearchResult.totalCount > 0) {
        response += `${t('search.found', { count: paginatedSearchResult.totalCount })}`;
      } else {
        response += `${t('search.noResults')}`;
        return response; // Return early if no results
      }
    } else {
      // Pagination header for subsequent pages
      response += `${t('search.showingPage', { page, total: paginatedSearchResult.totalPages })}\n\n`;
    }

    // List the search results
    for (let index = 0; index < paginatedSearchResult.conditionResults.length; index++) {
      const result = paginatedSearchResult.conditionResults[index];
      const displayIndex =
        (page - 1) * this.agent.plugin.settings.search.resultsPerPage + index + 1;
      response += `\n\n**${displayIndex}.** [[${result.document.path}]]\n`;

      // Get the file content directly
      const file = await this.agent.plugin.mediaTools.findFileByNameOrPath(result.document.path);

      if (file && result.keywordsMatched) {
        try {
          const fileContent = await this.agent.plugin.app.vault.cachedRead(file);

          // Get highlighted matches from the entire file content
          const highlightedMatches = result.keywordsMatched.reduce((acc, keyword) => {
            return [
              ...acc,
              ...this.highlightKeyword(
                keyword,
                this.agent.plugin.noteContentService.toMarkdownLink(fileContent)
              ),
            ];
          }, []);

          // Show up to 3 highlighted matches
          const matchesToShow = Math.min(3, highlightedMatches.length);

          if (matchesToShow > 0) {
            // Add each highlighted match to the response
            for (let i = 0; i < matchesToShow; i++) {
              // Format as a stw-search-result callout with position data
              const match = highlightedMatches[i];
              const callout = this.agent.plugin.noteContentService.formatCallout(
                match.highlightedText.trim(),
                'stw-search-result',
                {
                  line: match.lineNumber,
                  start: match.termMatches[0].start,
                  end: match.termMatches[match.termMatches.length - 1].end,
                  path: result.document.path,
                }
              );
              response += '\n' + callout;
            }

            // Show a message for additional matches
            if (highlightedMatches.length > 3) {
              response += `\n_${t('search.moreMatches', { count: highlightedMatches.length - 3 })}_`;
            }
          }
        } catch (error) {
          // Error reading file - continue with next result
        }
      }
    }

    // Add pagination footer if there are more pages
    if (page < paginatedSearchResult.totalPages) {
      response += `\n\n${t('search.useMoreCommand')}`;
    }

    return response;
  }

  /**
   * Builds a mapping from stemmed terms to their original forms found in the content.
   * This enables highlighting of original word forms that stem to the same root.
   */
  private buildContentStemmingMap(content: string): Map<string, string[]> {
    const contentMap = new Map<string, string[]>();

    // Create a tokenizer without stemming to get original terms
    const originalTokenizer = this.agent.plugin.searchService.contentTokenizer.withConfig({
      analyzers: [],
    });

    // Tokenize content to get original terms
    const originalTokens = originalTokenizer.tokenize(content);

    // Build mapping: stemmed term -> [original forms that exist in content]
    for (const token of originalTokens) {
      const stemmedForm = stemmer(token.term);

      if (!contentMap.has(stemmedForm)) {
        contentMap.set(stemmedForm, []);
      }

      const originals = contentMap.get(stemmedForm);
      if (originals && !originals.includes(token.term)) {
        originals.push(token.term);
      }
    }

    return contentMap;
  }

  private highlightKeyword(
    keyword: string,
    content: string,
    options?: {
      beforeMark?: string;
      afterMark?: string;
    }
  ): HighlighKeywordResult[] {
    const { beforeMark = '==', afterMark = '==' } = options || {};
    const tokenizer = this.agent.plugin.searchService.contentTokenizer.withConfig({
      removeStopwords: false,
    });
    const stemmedKeywordTerms = tokenizer.tokenize(keyword).map(item => item.term);
    // Tag terms have a different regex pattern
    const tagTerms = keyword.split(' ').reduce<string[]>((acc, term) => {
      if (term.startsWith('#')) {
        acc.push(term);
      }
      return acc;
    }, []);
    const originalKeywordTerms: string[] = [];
    const contentStemmingMap = this.buildContentStemmingMap(content);
    // Collect original terms from the stemmed keyword terms
    for (const term of stemmedKeywordTerms) {
      if (contentStemmingMap.has(term)) {
        originalKeywordTerms.push(...(contentStemmingMap.get(term) as string[]));
      }
    }
    const termsPattern = [...new Set([...stemmedKeywordTerms, ...originalKeywordTerms])].join('|');
    const tagTermsPattern = tagTerms.join('|');
    const lines = content.split('\n');
    const results: HighlighKeywordResult[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      const normalizedLineText = lineText
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks
        .normalize('NFC');

      if (!lineText.trim()) {
        continue;
      }

      const lineResults: HighlighKeywordResult['termMatches'] = [];
      let containStopwordsOnly = true;

      // Regex to match terms but exclude those inside markdown link paths: [display](path)
      // First, we need to identify positions inside markdown link paths and exclude them
      const markdownLinkPathRegex = /\]\([^)]+\)/g;
      const linkPathPositions: { start: number; end: number }[] = [];
      let linkMatch: RegExpExecArray | null;

      // Find all markdown link path positions
      while ((linkMatch = markdownLinkPathRegex.exec(normalizedLineText)) !== null) {
        linkPathPositions.push({
          start: linkMatch.index + 2, // Start after "]("
          end: linkMatch.index + linkMatch[0].length - 1, // End before ")"
        });
      }

      const regex = tagTermsPattern
        ? new RegExp(`${tagTermsPattern}|\\b(${termsPattern})\\b`, 'gi')
        : new RegExp(`\\b(${termsPattern})\\b`, 'gi');
      let match: RegExpExecArray | null;

      while ((match = regex.exec(normalizedLineText)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;

        // Check if this match is inside a markdown link path
        const isInsideLinkPath = linkPathPositions.some(
          linkPath => start >= linkPath.start && end <= linkPath.end
        );

        // Skip matches that are inside markdown link paths
        if (isInsideLinkPath) {
          continue;
        }

        lineResults.push({
          // Get term from the lineText not from the normalized or match[0]
          term: lineText.slice(start, end),
          start,
          end,
          match: match[0],
        });

        if (!STOPWORDS.has(match[0])) {
          containStopwordsOnly = false;
        }
      }

      if (lineResults.length === 0 || containStopwordsOnly) {
        continue;
      }

      lineResults.sort((a, b) => a.start - b.start);
      let lastIndex = 0;
      let highlightedText = '';

      for (const match of lineResults) {
        const inHighlight =
          highlightedText.slice(-afterMark.length) === afterMark && match.start - lastIndex < 2;

        // Remove the afterMark if it is in highlight
        if (inHighlight) {
          highlightedText = highlightedText.slice(0, -afterMark.length);
        }

        // Add text before the match
        highlightedText += lineText.slice(lastIndex, match.start);

        // Add highlighted match
        if (inHighlight) {
          highlightedText += match.term + afterMark;
        } else {
          highlightedText += beforeMark + match.term + afterMark;
        }

        // Update last processed position
        lastIndex = match.end;
      }

      // Add remaining text after the last match
      highlightedText += lineText.slice(lastIndex);

      results.push({
        highlightedText,
        lineNumber: lineIndex + 1,
        termMatches: lineResults,
      });
    }

    return results.sort((a, b) => b.termMatches.length - a.termMatches.length);
  }
}
