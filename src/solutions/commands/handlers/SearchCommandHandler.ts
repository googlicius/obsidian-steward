import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { extractSearchQueryV2, SearchQueryExtractionV2 } from 'src/lib/modelfusion/extractions';
import { highlightKeyword } from 'src/utils/highlightKeywords';
import { MediaTools } from 'src/tools/mediaTools';
import type StewardPlugin from 'src/main';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { PaginatedSearchResult } from 'src/solutions/search/types';

export class SearchCommandHandler extends CommandHandler {
  isContentRequired = true;

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the search command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.searching'));
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
    const { title, command, nextCommand } = params;
    const t = getTranslation(params.lang);

    try {
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
          status: CommandResultStatus.ERROR,
          error: new Error('Search index not built'),
        };
      }

      // Extract search parameters from the command content or use provided extraction
      const queryExtraction =
        options.extraction ||
        (await extractSearchQueryV2({
          command,
          lang: params.lang,
        }));

      // Check if there are multiple operations and we haven't already confirmed them
      if (queryExtraction.operations.length > 1 && !options.multipleOperationsConfirmed) {
        // Format the operations for display
        let message =
          t('search.multipleOperationsHeader', { count: queryExtraction.operations.length }) +
          '\n\n';

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
            const escapedFolders = new MarkdownUtil(operation.folders.join(', '))
              .escape()
              .getText();
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
        if (nextCommand && nextCommand.commandType.endsWith('_from_artifact')) {
          // Request confirmation before proceeding
          await this.renderer.updateConversationNote({
            path: title,
            newContent: t('search.confirmMultipleOperations'),
            command: 'search',
          });

          return {
            status: CommandResultStatus.NEEDS_CONFIRMATION,
            onConfirmation: () => {
              return this.handle(params, {
                extraction: queryExtraction,
                multipleOperationsConfirmed: true,
              });
            },
            onRejection: () => {
              return {
                status: CommandResultStatus.SUCCESS,
              };
            },
          };
        }
      }

      // Get the search results
      const queryResult = await this.plugin.searchService.searchV3(queryExtraction.operations);

      // Paginate the results for display (first page)
      const paginatedSearchResult = this.plugin.searchService.paginateResults(
        queryResult.conditionResults,
        1,
        10
      );

      // Format the search results
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
        this.plugin.artifactManager.storeArtifact(title, messageId, {
          type: ArtifactType.SEARCH_RESULTS,
          originalResults: queryResult.conditionResults,
        });

        // Create artifact content with description of results
        const artifactContent = `${t('search.artifactDescription', { count: queryResult.count })}\n\n${t('search.artifactNote')}`;

        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.artifactCreated', {
            type: ArtifactType.SEARCH_RESULTS,
          })}*`,
          artifactContent,
          role: {
            name: 'Assistant',
            showLabel: false,
          },
          command: 'search',
        });
      }

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error processing search command:', error);

      await this.renderer.updateConversationNote({
        path: title,
        newContent: `Error searching: ${error.message}`,
        role: 'Steward',
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Format search results into a markdown string for display
   */
  public async formatSearchResults(options: {
    paginatedSearchResult: PaginatedSearchResult;
    page?: number;
    headerText?: string;
    lang?: string;
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
      const displayIndex = (page - 1) * 10 + index + 1;
      response += `\n\n**${displayIndex}.** [[${result.document.path}]]\n`;

      // Get the file content directly
      const file = await MediaTools.getInstance().findFileByNameOrPath(result.document.path);

      if (file && result.keywordsMatched) {
        try {
          const fileContent = await this.plugin.app.vault.cachedRead(file);

          // Get highlighted matches from the entire file content
          const highlightedMatches = result.keywordsMatched.reduce((acc, keyword) => {
            return [...acc, ...highlightKeyword(keyword, fileContent)];
          }, []);

          // Show up to 3 highlighted matches
          const matchesToShow = Math.min(3, highlightedMatches.length);

          if (matchesToShow > 0) {
            // Add each highlighted match to the response
            for (let i = 0; i < matchesToShow; i++) {
              // Format as a stw-search-result callout with position data
              const match = highlightedMatches[i];
              const callout = this.plugin.noteContentService.formatCallout(
                match.text,
                'stw-search-result',
                {
                  line: match.lineNumber,
                  start: match.start,
                  end: match.end,
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
}
