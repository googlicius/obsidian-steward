import { CommandHandlerParams, CommandResult } from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/solutions/artifact';
import { SearchQueryExtractionV2, SearchOperationV2 } from './zSchemas';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { PaginatedSearchResult } from 'src/solutions/search/types';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { STOPWORDS } from 'src/solutions/search';
import { stemmer } from 'src/solutions/search/tokenizer/stemmer';
import { StewardPluginSettings } from 'src/types/interfaces';
import { DEFAULT_SETTINGS } from 'src/constants';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { streamText, tool } from 'ai';
import { searchPromptV2 } from './searchPromptV2';
import { searchQueryExtractionSchema } from './zSchemas';
import { getLanguage } from 'obsidian';
import { SystemPromptModifier } from '../../SystemPromptModifier';
import { Intent, IntentResultStatus } from '../../types';
import { Agent } from '../../Agent';
import { waitForError } from 'src/utils/waitForError';

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

export class SearchCommandHandler extends Agent {
  isContentRequired = true;

  /**
   * Render the loading indicator for the search command
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.searching'));
  }

  private async shouldUpdateTitle(title: string): Promise<boolean> {
    try {
      // Get all messages from the conversation
      const messages = await this.renderer.extractAllConversationMessages(title);

      // If there are only 1 message (user)
      if (messages.length === 1 && messages[0].role === 'user' && messages[0].intent === 'search') {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking if conversation is only help command:', error);
      return false;
    }
  }

  /**
   * Handle a search command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      extraction?: SearchQueryExtractionV2;
      multipleOperationsConfirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, intent, nextIntent } = params;
    const t = getTranslation(params.lang);

    // let title = params.title;

    // title =
    //   params.title !== 'Search' && (await this.shouldUpdateTitle(title))
    //     ? await this.renderer.updateTheTitle(params.title, 'Search')
    //     : params.title;

    // Check if search index is built
    const isIndexBuilt = await this.plugin.searchService.documentStore.isIndexBuilt();

    if (!isIndexBuilt) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent:
          t('search.indexNotBuilt') +
          '\n\n' +
          t('search.buildIndexFirst') +
          '\n\n' +
          `*${t('search.privacyNotice')}*`,
        role: 'Steward',
        command: 'search',
        lang: params.lang,
      });
      return {
        status: IntentResultStatus.ERROR,
        error: new Error('Search index not built'),
      };
    }

    // Extract search parameters from the command content or use provided extraction
    const queryExtraction =
      options.extraction ||
      (await this.extractSearchQueryV2({
        title,
        intent,
        lang: params.lang,
        searchSettings: this.plugin.settings.search,
      }));

    // Check if there are multiple operations and we haven't already confirmed them
    if (
      queryExtraction.needsLLM &&
      queryExtraction.operations.length > 1 &&
      !options.multipleOperationsConfirmed
    ) {
      // Format the operations for display
      let message =
        t('search.multipleOperationsHeader', {
          count: queryExtraction.operations.length,
        }) + '\n\n';

      for (let index = 0; index < queryExtraction.operations.length; index++) {
        const operation = queryExtraction.operations[index];
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
        if (index < queryExtraction.operations.length - 1) {
          message += '\n';
        }
      }

      await this.renderer.updateConversationNote({
        path: title,
        newContent: message,
        command: 'search',
        includeHistory: false,
        role: 'Steward',
      });

      // Check if the next command will operate on the search results
      if (nextIntent && nextIntent.type.endsWith('_from_artifact')) {
        // Request confirmation before proceeding
        await this.renderer.updateConversationNote({
          path: title,
          newContent: t('search.confirmMultipleOperations'),
          command: 'search',
        });

        return {
          status: IntentResultStatus.NEEDS_CONFIRMATION,
          onConfirmation: () => {
            return this.handle(params, {
              extraction: queryExtraction,
              multipleOperationsConfirmed: true,
            });
          },
          onRejection: () => {
            return {
              status: IntentResultStatus.SUCCESS,
            };
          },
        };
      }
    }

    const queryResult = await this.plugin.searchService.searchV3(queryExtraction.operations);

    // Paginate the results for display (first page)
    const resultsPerPage = this.plugin.settings.search.resultsPerPage;
    const paginatedSearchResult = this.plugin.searchService.paginateResults(
      queryResult.conditionResults,
      1,
      resultsPerPage
    );

    const response = await this.formatSearchResults({
      paginatedSearchResult,
      headerText: queryExtraction.explanation,
      lang: queryExtraction.lang,
    });

    // Update the conversation note
    const messageId = await this.renderer.updateConversationNote({
      path: title,
      newContent: response,
      role: 'Steward',
      command: 'search',
      lang: queryExtraction.lang,
    });

    // Store the search results in the artifact manager
    if (messageId && queryResult.conditionResults.length > 0) {
      await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        text: `*${t('common.artifactCreated', {
          type: ArtifactType.SEARCH_RESULTS,
        })}*`,
        artifact: {
          artifactType: ArtifactType.SEARCH_RESULTS,
          originalResults: queryResult.conditionResults,
        },
      });
    }

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  /**
   * Extract search parameters from a natural language request using AI (v2)
   * @returns Extracted search parameters and explanation
   */
  private async extractSearchQueryV2(args: {
    title: string;
    intent: Intent;
    searchSettings?: StewardPluginSettings['search'];
    lang?: string | null;
  }): Promise<SearchQueryExtractionV2> {
    const { title, intent, lang, searchSettings = DEFAULT_SETTINGS.search } = args;
    const { systemPrompts = [] } = intent;
    const t = getTranslation(lang);

    // Check if input is wrapped in quotation marks for direct search
    const searchTerm = getQuotedQuery(intent.query);

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
    const trimmedInput = intent.query.trim();
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

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: intent.model,
      generateType: 'text',
    });

    const modifier = new SystemPromptModifier(systemPrompts);
    const additionalSystemPrompts = modifier.getAdditionalSystemPrompts();

    // Create an operation-specific abort signal
    const abortSignal = this.plugin.abortService.createAbortController('search-query-v2');

    // Create tool for search query extraction
    const searchQueryExtractionTool = tool({
      parameters: searchQueryExtractionSchema,
    });

    // Collect the error from the stream to handle it with our handle function.
    let streamError: Error | null = null;

    // Use streamText with tool to disable reasoning responses
    const { textStream, toolCalls: toolCallsPromise } = streamText({
      ...llmConfig,
      abortSignal,
      system: modifier.apply(searchPromptV2(intent)),
      messages: [
        ...additionalSystemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content: intent.query },
      ],
      tools: {
        extractSearchQuery: searchQueryExtractionTool,
      },
      toolChoice: 'required',
      onError: ({ error }) => {
        streamError = error instanceof Error ? error : new Error(String(error));
      },
    });

    const streamErrorPromise = waitForError(() => streamError);

    // Stream the text directly to the conversation note
    await Promise.race([
      this.renderer.streamConversationNote({
        path: title,
        stream: textStream,
        command: 'search',
        includeHistory: false,
      }),
      streamErrorPromise,
    ]);

    await this.renderIndicator(title, lang);

    // Wait for tool calls and extract the result
    const toolCalls = (await Promise.race([toolCallsPromise, streamErrorPromise])) as Awaited<
      typeof toolCallsPromise
    >;

    // Find the extractSearchQuery tool call
    const searchQueryToolCall = toolCalls.find(
      toolCall => toolCall.toolName === 'extractSearchQuery'
    );

    if (!searchQueryToolCall) {
      throw new Error('No search query extraction tool call found');
    }

    // Extract the result from the tool call args
    const object = searchQueryToolCall.args;

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

    // Repair extraction operations by moving file-related properties to filenames
    object.operations = this.repairExtractionOperations(object.operations);

    return {
      ...object,
      lang: object.lang || lang || getLanguage(),
      needsLLM: true,
    };
  }

  /**
   * Repair extraction operations
   * @param operations Array of search operations to repair
   * @returns Repaired search operations
   */
  private repairExtractionOperations(operations: SearchOperationV2[]): SearchOperationV2[] {
    return operations.map(operation => {
      const filePropertyNames = ['file_name', 'filename', 'note_name', 'notename', 'name'];
      const repairedOperation = { ...operation };

      // Iterate backwards to safely use splice
      for (let i = repairedOperation.properties.length - 1; i >= 0; i--) {
        const prop = repairedOperation.properties[i];
        if (filePropertyNames.includes(prop.name.toLowerCase())) {
          repairedOperation.filenames.push(prop.value);
          repairedOperation.properties.splice(i, 1);
        }
      }

      return repairedOperation;
    });
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
      const displayIndex = (page - 1) * this.plugin.settings.search.resultsPerPage + index + 1;
      response += `\n\n**${displayIndex}.** [[${result.document.path}]]\n`;

      // Get the file content directly
      const file = await this.plugin.mediaTools.findFileByNameOrPath(result.document.path);

      if (file && result.keywordsMatched) {
        try {
          const fileContent = await this.plugin.app.vault.cachedRead(file);

          // Get highlighted matches from the entire file content
          const highlightedMatches = result.keywordsMatched.reduce((acc, keyword) => {
            return [
              ...acc,
              ...this.highlightKeyword(
                keyword,
                this.plugin.noteContentService.toMarkdownLink(fileContent)
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
              const callout = this.plugin.noteContentService.formatCallout(
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
          logger.error('Error reading file:', error);
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
   *
   * @param content The content to analyze
   * @returns Map where keys are stemmed terms and values are arrays of original forms
   */
  private buildContentStemmingMap(content: string): Map<string, string[]> {
    const contentMap = new Map<string, string[]>();

    // Create a tokenizer without stemming to get original terms
    const originalTokenizer = this.plugin.searchService.contentTokenizer.withConfig({
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
    const tokenizer = this.plugin.searchService.contentTokenizer.withConfig({
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
