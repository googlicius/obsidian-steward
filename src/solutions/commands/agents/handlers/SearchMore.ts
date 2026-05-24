import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { Search } from './Search';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/solutions/artifact';
import { ConditionResult } from 'src/solutions/search/searchEngineV3';
import { IndexedDocument } from 'src/database/SearchDatabase';

const { getTranslation } = getBundledInternal('i18n');

// SEARCH_MORE tool doesn't need args
const searchMoreSchema = z.object({});

export type SearchMoreArgs = z.infer<typeof searchMoreSchema>;

export class SearchMore {
  constructor(
    private readonly agent: AgentHandlerContext,
    private readonly searchHandler: Search
  ) {}

  public static async getSearchMoreTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: searchMoreSchema,
    });
  }

  /**
   * Handle search more tool call to display additional search results
   */
  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<SearchMoreArgs> }
  ): Promise<AgentResult> {
    const { title } = ctx.agentHandlerParams;
    const t = getTranslation(ctx.lang);

    try {
      // Find the most recent search message metadata
      const stewardSearchMetadata = await this.agent.renderer.findMostRecentMessageMetadata({
        conversationTitle: title,
        command: 'search',
        role: 'steward',
      });

      if (!stewardSearchMetadata) {
        await ctx.updateConversationNote({
          newContent: t('search.noRecentSearch'),
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
        await ctx.updateConversationNote({
          newContent: t('search.noRecentSearch'),
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
        await ctx.updateConversationNote({
          newContent: t('search.noMoreResults'),
        });

        return {
          status: IntentResultStatus.SUCCESS,
        };
      }

      // Format the results using the Search handler's format method
      const response = await this.searchHandler.formatSearchResults({
        paginatedSearchResult,
        page,
        lang: ctx.lang,
      });

      // Update the conversation note
      await ctx.updateConversationNote({
        newContent: response,
        command: 'more',
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error processing search more command:', error);

      await ctx.updateConversationNote({
        newContent: `Error showing more results: ${error instanceof Error ? error.message : String(error)}`,
      });

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }
}
