import { getCdnLib } from 'src/utils/cdnUrls';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/solutions/artifact';
import { ConditionResult } from 'src/solutions/search/searchEngineV3';
import { IndexedDocument } from 'src/database/SearchDatabase';

// SEARCH_MORE tool doesn't need args
const searchMoreSchema = z.object({});

export type SearchMoreArgs = z.infer<typeof searchMoreSchema>;

export class SearchMore {
  constructor(private readonly agent: SuperAgent) {}

  public static async getSearchMoreTool() {
    const { tool } = await getCdnLib('ai');
    return tool({ inputSchema: searchMoreSchema });
  }

  /**
   * Handle search more tool call to display additional search results
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<SearchMoreArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('SearchMore.handle invoked without handlerId');
    }

    try {
      // Find the most recent search message metadata
      const stewardSearchMetadata = await this.agent.renderer.findMostRecentMessageMetadata({
        conversationTitle: title,
        command: 'search',
        role: 'steward',
      });

      if (!stewardSearchMetadata) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('search.noRecentSearch'),
          lang,
          handlerId,
        });

        return {
          status: IntentResultStatus.ERROR,
          error: 'No recent search found',
        };
      }

      // Find if there were previous "more" commands to determine the page number
      const moreCommandMetadata = await this.agent.renderer.findMostRecentMessageMetadata({
        conversationTitle: title,
        command: 'more',
        role: 'steward',
      });

      // Default to page 2 if this is the first "more" command
      const page = moreCommandMetadata ? parseInt(moreCommandMetadata.PAGE) + 1 : 2;

      // Retrieve the search results from the artifact manager
      const searchArtifact = await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactByType(ArtifactType.SEARCH_RESULTS);

      if (!searchArtifact) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('search.noRecentSearch'),
          lang,
          handlerId,
        });

        return {
          status: IntentResultStatus.ERROR,
          error: 'No search results artifact found',
        };
      }

      // Get paginated results for the current page
      const resultsPerPage = this.agent.plugin.settings.search.resultsPerPage;
      const paginatedSearchResult = this.agent.plugin.searchService.paginateResults(
        searchArtifact.originalResults as ConditionResult<IndexedDocument>[],
        page,
        resultsPerPage
      );

      // If we're past the last page, inform the user
      if (page > paginatedSearchResult.totalPages) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('search.noMoreResults'),
          lang,
          handlerId,
        });

        return {
          status: IntentResultStatus.SUCCESS,
        };
      }

      // Format the results using the Search handler's format method
      const response = await this.agent.search.formatSearchResults({
        paginatedSearchResult,
        page,
        lang,
      });

      // Update the conversation note
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: response,
        command: 'more',
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error processing search more command:', error);

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `Error showing more results: ${error instanceof Error ? error.message : String(error)}`,
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }
}
