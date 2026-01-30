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
import { splitCamelCase, removeDiacritics } from 'src/solutions/search/tokenizer/tokenizer';
import { parsePDFPagePath, decodePDFPosition } from 'src/solutions/search/binaryContent/types';
import { TermSource } from 'src/database/SearchDatabase';
import { z } from 'zod/v3';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { getLanguage } from 'obsidian';
import { DEFAULT_SETTINGS } from 'src/constants';
import { StewardPluginSettings } from 'src/types/interfaces';

// Define the Zod schema for search operation validation
const searchOperationSchema = z.object({
  keywords: z.array(z.string()).describe(`General terms or concepts to search for in file content.
If a term or phrase is wrapped in quotation marks (e.g., "cat or dog"), preserve the quotes exactly as is for exact match queries.
NOTE: keywords only used for searching in file content, not title or filename.`),
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
  operations: z
    .array(searchOperationSchema)
    .describe(
      `An array of search operations.
If the user wants to search with different criteria in different locations, return multiple operations.
  `
    )
    .transform(operations => {
      const transformedOperations: z.infer<typeof searchOperationSchema>[] = [];

      for (const operation of operations) {
        const hasKeywords = operation.keywords.length > 0;
        const tagProperties = operation.properties.filter(prop => prop.name === 'tag');
        const hasTagProperties = tagProperties.length > 0;
        const nonTagProperties = operation.properties.filter(prop => prop.name !== 'tag');

        // Instead of spending tokens to tell AIs that keywords are not tags, we will handle it.
        // Only split if any keyword value matches any tag value
        if (hasKeywords && hasTagProperties) {
          const tagValues = tagProperties.map(prop => prop.value.toLowerCase());
          const matchingKeywords = operation.keywords.filter(keyword =>
            tagValues.includes(keyword.toLowerCase())
          );
          const hasMatchingKeywords = matchingKeywords.length > 0;

          if (hasMatchingKeywords) {
            // Split into two operations: one for keywords (excluding matching ones), one for tags
            const nonMatchingKeywords = operation.keywords.filter(
              keyword => !tagValues.includes(keyword.toLowerCase())
            );

            // Operation 1: non-matching keywords + non-tag properties (preserve filenames and folders)
            transformedOperations.push({
              keywords: nonMatchingKeywords,
              filenames: operation.filenames,
              folders: operation.folders,
              properties: nonTagProperties,
            });

            // Operation 2: tag properties only (preserve filenames and folders)
            transformedOperations.push({
              keywords: [],
              filenames: operation.filenames,
              folders: operation.folders,
              properties: tagProperties,
            });
          } else {
            // No matching keywords and tags, keep operation as is
            transformedOperations.push(operation);
          }
        } else {
          // Keep operation as is if it doesn't have both keywords and tags
          transformedOperations.push(operation);
        }
      }

      return transformedOperations;
    }),
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
    const { title, lang, handlerId } = params;
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
        step: params.invocationCount,
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
        step: params.invocationCount,
      });
    }

    return this.performSearch({
      title,
      operations,
      explanation,
      lang: searchLang || lang,
      handlerId,
      toolCall: options.toolCall,
      step: params.invocationCount,
    });
  }

  /**
   * Perform the actual search operation
   */
  private async performSearch(params: {
    title: string;
    operations: SearchOperationV2[];
    explanation: string;
    lang: string | null | undefined;
    handlerId: string;
    toolCall: ToolCallPart<SearchArgs>;
    step?: number;
  }): Promise<AgentResult> {
    const { title, operations, explanation, lang, handlerId, toolCall, step } = params;
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
      step,
    });

    if (queryResult.conditionResults.length === 0) {
      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'search',
        handlerId,
        step,
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
      } else {
        resultText += `\n\n${t('search.resultAvailableInArtifact', { artifactId })}`;
      }

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'search',
        handlerId,
        step,
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

      // Check if this is a PDF page result
      const pdfPageInfo = parsePDFPagePath(result.document.path);

      if (pdfPageInfo) {
        // PDF page result - format with deep link and term-based snippet
        // Use full path with page number: file.pdf#page=N
        const pathWithoutExtension = result.document.path.slice(
          0,
          result.document.path.lastIndexOf('.')
        );
        response += `\n\n**${displayIndex}.** [[${result.document.path}|${pathWithoutExtension} - Page ${pdfPageInfo.pageNumber}]]\n`;
        response += await this.formatPDFSearchResult(result, pdfPageInfo);
      } else {
        // Regular file result
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
            }, [] as HighlighKeywordResult[]);

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
    }

    // Add pagination footer if there are more pages
    if (page < paginatedSearchResult.totalPages) {
      response += `\n\n${t('search.useMoreCommand')}`;
    }

    return response;
  }

  /**
   * Format a PDF search result with snippet and deep link
   * @param result The search result containing the PDF page document
   * @param pdfPageInfo Parsed PDF page path info (pdfPath and pageNumber)
   * @returns Formatted markdown string with callout containing snippet and deep link
   */
  private async formatPDFSearchResult(
    result: PaginatedSearchResult<IndexedDocument>['conditionResults'][0],
    pdfPageInfo: { pdfPath: string; pageNumber: number }
  ): Promise<string> {
    const documentId = result.document.id;
    if (!documentId || !result.keywordsMatched || result.keywordsMatched.length === 0) {
      return '';
    }

    // Get all terms for this document to reconstruct content
    const allTerms =
      await this.agent.plugin.searchService.documentStore.getTermsByDocumentId(documentId);

    // Filter to PDFContent terms only
    const pdfTerms = allTerms.filter(
      t => t.source === TermSource.PDFContent && t.isOriginal === true
    );

    if (pdfTerms.length === 0) {
      return '';
    }

    // Flatten all term occurrences with their positions
    const termOccurrences: Array<{ term: string; position: number }> = [];
    for (const term of pdfTerms) {
      for (const pos of term.positions) {
        termOccurrences.push({ term: term.term, position: pos });
      }
    }

    // Sort by position
    termOccurrences.sort((a, b) => a.position - b.position);

    // Convert user keywords to tokenized terms for matching
    // Keywords like "stepladder over" need to be broken into ["stepladder", "over"]
    const matchedTerms = new Set<string>();
    for (const keyword of result.keywordsMatched) {
      const terms = this.agent.plugin.searchService.pdfTokenizer.getUniqueTerms(keyword);
      for (const term of terms) {
        matchedTerms.add(term.toLowerCase());
      }
    }

    // Find the best cluster of matched terms (where most search terms appear close together)
    // This prevents picking an isolated "she" when "she dragged the stepladder over" is
    // the actual phrase the user is looking for
    let bestClusterStart = -1;
    let bestClusterScore = 0;
    const windowSize = 21; // 10 before + 1 center + 10 after

    for (let i = 0; i < termOccurrences.length; i++) {
      const occ = termOccurrences[i];
      if (!matchedTerms.has(occ.term.toLowerCase())) {
        continue; // Skip non-matched terms as cluster centers
      }

      // Count how many unique matched terms appear in this window
      const windowStart = Math.max(0, i - 10);
      const windowEnd = Math.min(termOccurrences.length, i + 11);
      const termsInWindow = new Set<string>();

      for (let j = windowStart; j < windowEnd; j++) {
        const termLower = termOccurrences[j].term.toLowerCase();
        if (matchedTerms.has(termLower)) {
          termsInWindow.add(termLower);
        }
      }

      // Score based on number of unique matched terms in window
      const score = termsInWindow.size;
      if (score > bestClusterScore) {
        bestClusterScore = score;
        bestClusterStart = i;
      }
    }

    if (bestClusterStart === -1) {
      return '';
    }

    // Get window of terms around the best cluster center
    const contextStart = Math.max(0, bestClusterStart - 10);
    const contextEnd = Math.min(termOccurrences.length, bestClusterStart + 11);
    const contextTerms = termOccurrences.slice(contextStart, contextEnd);
    const matchedOccurrence = termOccurrences[bestClusterStart];

    // Build snippet with highlighting
    let snippet = '';
    let lastItemIndex = -1;

    for (const occ of contextTerms) {
      const decoded = decodePDFPosition(occ.position);

      // Add line break if item index changed (different text chunk in PDF)
      if (lastItemIndex !== -1 && decoded.itemIndex !== lastItemIndex) {
        snippet += ' ';
      } else if (snippet.length > 0) {
        snippet += ' ';
      }

      // Highlight matched terms
      if (matchedTerms.has(occ.term.toLowerCase())) {
        snippet += `==${occ.term}==`;
      } else {
        snippet += occ.term;
      }

      lastItemIndex = decoded.itemIndex;
    }

    // Find all matched terms in context to create a selection spanning all matches
    const matchedInContext = contextTerms.filter(occ => matchedTerms.has(occ.term.toLowerCase()));

    if (matchedInContext.length === 0) {
      return '';
    }

    // Use first matched term for start position
    const firstMatch = matchedInContext[0];
    const firstDecoded = decodePDFPosition(firstMatch.position);
    const beginIndex = firstDecoded.itemIndex;
    const beginOffset = firstDecoded.charOffset;

    // Use last matched term for end position
    const lastMatch = matchedInContext[matchedInContext.length - 1];
    const lastDecoded = decodePDFPosition(lastMatch.position);
    const endIndex = lastDecoded.itemIndex;
    const endOffset = lastDecoded.charOffset + lastMatch.term.length;

    // Create deep link
    const deepLink = `${pdfPageInfo.pdfPath}#page=${pdfPageInfo.pageNumber}&selection=${beginIndex},${beginOffset},${endIndex},${endOffset}`;

    // Format as callout with deep link reference
    // Include start/end for validation, isPdf flag for special handling
    const callout = this.agent.plugin.noteContentService.formatCallout(
      snippet.trim(),
      'stw-search-result',
      {
        path: deepLink,
        start: 0, // Required for validation
        end: 1, // Required for validation
        line: 1, // Required for validation
      }
    );

    return '\n' + callout;
  }

  /**
   * Builds mappings for content highlighting:
   * - stemmingMap: stemmed term -> [normalized terms] (for matching stemmed forms)
   * - termToWordMap: normalizedTerm -> [original unsplit words] (for highlighting whole camelCase words)
   */
  private buildContentTermMap(content: string): {
    stemmingMap: Map<string, string[]>;
    termToWordMap: Map<string, string[]>;
  } {
    const stemmingMap = new Map<string, string[]>();
    const termToWordMap = new Map<string, string[]>();

    // Extract words from content (before any normalization)
    const words = content.match(/[\p{L}\p{N}]+/gu) || [];

    for (const word of words) {
      // Apply camelCase split + lowercase + diacritic removal to get normalized terms
      const splitWord = splitCamelCase(word);
      const terms = splitWord.toLowerCase().split(/\s+/).filter(Boolean);

      for (const term of terms) {
        // Normalize term by removing diacritics for map key
        const normalizedTerm = removeDiacritics(term);

        // Build termToWordMap: normalizedTerm -> original unsplit words
        let wordList = termToWordMap.get(normalizedTerm);
        if (!wordList) {
          wordList = [];
          termToWordMap.set(normalizedTerm, wordList);
        }
        if (!wordList.includes(word)) {
          wordList.push(word);
        }

        // Build stemmingMap: stemmed -> normalized terms
        const stemmedForm = stemmer(normalizedTerm);
        let originals = stemmingMap.get(stemmedForm);
        if (!originals) {
          originals = [];
          stemmingMap.set(stemmedForm, originals);
        }
        if (!originals.includes(normalizedTerm)) {
          originals.push(normalizedTerm);
        }
      }
    }

    return { stemmingMap, termToWordMap };
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
    const { stemmingMap, termToWordMap } = this.buildContentTermMap(content);

    // Collect original words that should be highlighted
    const wordsToHighlight = new Set<string>();
    for (const term of stemmedKeywordTerms) {
      // Check termToWordMap for direct term matches
      const directWords = termToWordMap.get(term);
      if (directWords) {
        directWords.forEach(w => wordsToHighlight.add(w));
      }

      // Check stemmingMap for stemmed matches, then find their original words
      const origTerms = stemmingMap.get(term);
      if (origTerms) {
        for (const origTerm of origTerms) {
          const words = termToWordMap.get(origTerm);
          if (words) {
            words.forEach(w => wordsToHighlight.add(w));
          }
        }
      }
    }

    // Escape special regex characters in words
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build pattern from original words (case-insensitive matching)
    const wordsPattern = [...wordsToHighlight].map(w => escapeRegex(w)).join('|');
    const tagTermsPattern = tagTerms.join('|');
    const lines = content.split('\n');
    const results: HighlighKeywordResult[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];

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

      // Find all markdown link path positions (using original lineText since we're matching against it)
      while ((linkMatch = markdownLinkPathRegex.exec(lineText)) !== null) {
        linkPathPositions.push({
          start: linkMatch.index + 2, // Start after "]("
          end: linkMatch.index + linkMatch[0].length - 1, // End before ")"
        });
      }

      // Skip if no words to highlight
      if (!wordsPattern && !tagTermsPattern) {
        continue;
      }

      const regex = tagTermsPattern
        ? new RegExp(`${tagTermsPattern}|\\b(${wordsPattern})\\b`, 'gi')
        : wordsPattern
          ? new RegExp(`\\b(${wordsPattern})\\b`, 'gi')
          : null;

      if (!regex) {
        continue;
      }

      let match: RegExpExecArray | null;

      while ((match = regex.exec(lineText)) !== null) {
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
          term: match[0],
          start,
          end,
          match: match[0],
        });

        // Check stopwords using lowercase version
        if (!STOPWORDS.has(match[0].toLowerCase())) {
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
