import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import StewardPlugin from 'src/main';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { SearchCommandHandler } from './SearchCommandHandler';

export class MoreCommandHandler extends CommandHandler {
	constructor(public readonly plugin: StewardPlugin) {
		super();
	}

	/**
	 * Handle a "more" command to display additional search results
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, lang } = params;
		const t = getTranslation(lang);

		try {
			// Find the most recent search message metadata
			const stewardSearchMetadata = await this.renderer.findMostRecentMessageMetadata(
				title,
				'search',
				'steward'
			);

			if (!stewardSearchMetadata) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('search.noRecentSearch'),
					role: 'Steward',
				});

				return {
					status: CommandResultStatus.ERROR,
					error: 'No recent search found',
				};
			}

			// Find if there were previous "more" commands to determine the page number
			const moreCommandMetadata =
				await this.plugin.conversationRenderer.findMostRecentMessageMetadata(
					title,
					'more',
					'steward'
				);

			// Default to page 2 if this is the first "more" command
			const page = moreCommandMetadata ? parseInt(moreCommandMetadata.PAGE) + 1 : 2;

			// Retrieve the search results from the artifact manager
			const searchArtifact = this.plugin.artifactManager.getArtifact(
				title,
				stewardSearchMetadata.ID
			);

			if (!searchArtifact || searchArtifact.type !== ArtifactType.SEARCH_RESULTS) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('search.noRecentSearch'),
					role: 'Steward',
				});

				return {
					status: CommandResultStatus.ERROR,
					error: 'No search results artifact found',
				};
			}

			// Get paginated results for the current page
			const paginatedDocs = this.plugin.searchService.searchEngine.paginateResults(
				searchArtifact.originalResults,
				page,
				10
			);

			// If we're past the last page, inform the user
			if (page > paginatedDocs.totalPages) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('search.noMoreResults'),
					role: 'Steward',
				});

				return {
					status: CommandResultStatus.SUCCESS,
				};
			}

			// Format the results using the search handler's format method
			const searchHandler = SearchCommandHandler.getInstance(this.plugin);
			const response = await searchHandler.formatSearchResults({
				paginatedDocs,
				page,
				lang,
			});

			// Update the conversation note
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response,
				role: 'Steward',
				command: 'more',
			});

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			logger.error('Error processing more command:', error);

			await this.renderer.updateConversationNote({
				path: title,
				newContent: `Error showing more results: ${error.message}`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
