import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { extractSearchQueryV2 } from 'src/lib/modelfusion/extractions';
import { highlightKeyword } from 'src/utils/highlightKeywords';
import { PaginatedSearchResultV2 } from 'src/solutions/search';
import { MediaTools } from 'src/tools/mediaTools';

import type StewardPlugin from 'src/main';

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
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, command } = params;

    try {
      // Extract search parameters from the command content
      const queryExtraction = await extractSearchQueryV2({
        command,
        lang: params.lang,
      });

      const t = getTranslation(queryExtraction.lang);

      // Get the search results
      const docs = await this.plugin.searchService.searchEngine.searchV2(
        queryExtraction.operations
      );

      // Paginate the results for display (first page)
      const paginatedDocs = this.plugin.searchService.searchEngine.paginateResults(docs, 1, 10);

      // Format the search results
      const response = await this.formatSearchResults({
        paginatedDocs,
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
      if (messageId && docs.length > 0) {
        this.plugin.artifactManager.storeArtifact(title, messageId, {
          type: ArtifactType.SEARCH_RESULTS,
          originalResults: docs,
        });
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('common.artifactCreated', {
            type: ArtifactType.SEARCH_RESULTS,
          })}*`,
          command: 'search',
          role: 'System',
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
    paginatedDocs: PaginatedSearchResultV2;
    page?: number;
    headerText?: string;
    lang?: string;
  }): Promise<string> {
    const { paginatedDocs, headerText, lang } = options;
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
      if (paginatedDocs.totalCount > 0) {
        response += `${t('search.found', { count: paginatedDocs.totalCount })}`;
      } else {
        response += `${t('search.noResults')}`;
        return response; // Return early if no results
      }
    } else {
      // Pagination header for subsequent pages
      response += `${t('search.showingPage', { page, total: paginatedDocs.totalPages })}\n\n`;
    }

    // List the search results
    for (let index = 0; index < paginatedDocs.documents.length; index++) {
      const result = paginatedDocs.documents[index];
      const displayIndex = (page - 1) * 10 + index + 1;
      response += `\n\n**${displayIndex}.** [[${result.path}]]\n`;

      // Get the file content directly
      const file = await MediaTools.getInstance().findFileByNameOrPath(result.path);

      if (file && 'keywordsMatched' in result) {
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
                  path: result.path,
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
          console.error('Error reading file:', error);
        }
      }
    }

    // Add pagination footer if there are more pages
    if (page < paginatedDocs.totalPages) {
      response += `\n\n${t('search.useMoreCommand')}`;
    }

    return response;
  }
}
