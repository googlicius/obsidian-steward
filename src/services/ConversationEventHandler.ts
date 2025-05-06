import {
	Events,
	ErrorEvents,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationCommandReceivedPayload,
	MoveQueryExtractedPayload,
	CommandIntentExtractedPayload,
	MoveFromSearchResultConfirmedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import * as mathTools from '../tools/mathTools';
import StewardPlugin from '../main';
import i18next, { getTranslation } from '../i18n';
import { highlightKeywords } from '../utils/highlightKeywords';
import {
	extractCommandIntent,
	extractMoveQueryV2,
	extractSearchQueryV2,
	MoveOperationV2,
} from '../lib/modelfusion';
import { IndexedDocument } from '../database/PluginDatabase';
import { ConversationRenderer } from './ConversationRenderer';
import {
	ArtifactType,
	ConversationArtifactManager,
	SearchResultsArtifact,
} from './ConversationArtifactManager';
import { extractMoveFromSearchResult } from '../lib/modelfusion';
import { PaginatedSearchResultV2 } from '../searchIndexer';
import { logger } from 'src/utils/logger';
import { TFile } from 'obsidian';
import {
	extractUpdateFromSearchResult,
	UpdateInstruction,
} from 'src/lib/modelfusion/updateFromSearchResultExtraction';
import { extractUpdateCommand } from 'src/lib/modelfusion/updateExtraction';

interface Props {
	plugin: StewardPlugin;
}

export class ConversationEventHandler {
	private readonly plugin: StewardPlugin;
	private readonly renderer: ConversationRenderer;
	private readonly artifactManager: ConversationArtifactManager;
	private readonly mediaGenerationService: StewardPlugin['mediaGenerationService'];

	constructor(props: Props) {
		this.plugin = props.plugin;
		this.renderer = new ConversationRenderer(this.plugin);
		this.artifactManager = ConversationArtifactManager.getInstance();
		this.mediaGenerationService = this.plugin.mediaGenerationService;
		this.setupListeners();
	}

	private setupListeners(): void {
		// Listen for new conversation notes
		eventEmitter.on(Events.CONVERSATION_NOTE_CREATED, (payload: ConversationNoteCreatedPayload) => {
			this.handleNewConversation(payload);
		});

		// Listen for user commands in conversation
		eventEmitter.on(
			Events.CONVERSATION_COMMAND_RECEIVED,
			(payload: ConversationCommandReceivedPayload) => {
				this.handleConversationCommand(payload);
			}
		);

		// Listen for conversation link inserted
		eventEmitter.on(
			Events.CONVERSATION_LINK_INSERTED,
			(payload: ConversationLinkInsertedPayload) => {
				this.handleConversationLinkInserted(payload);
			}
		);

		// Listen for move query extracted
		eventEmitter.on(Events.MOVE_QUERY_EXTRACTED, (payload: MoveQueryExtractedPayload) => {
			this.handleMoveOperation(payload);
		});

		// Listen for move from search result confirmed
		eventEmitter.on(
			Events.MOVE_FROM_SEARCH_RESULT_CONFIRMED,
			(payload: MoveFromSearchResultConfirmedPayload) => {
				this.handleMoveOperation(payload);
			}
		);

		// Listen for command intent extracted
		eventEmitter.on(Events.COMMAND_INTENT_EXTRACTED, (payload: CommandIntentExtractedPayload) => {
			this.handleCommandIntentExtracted(payload);
		});

		// Listen for errors
		eventEmitter.on(ErrorEvents.MATH_PROCESSING_ERROR, payload => {
			this.handleError(payload);
		});
	}

	private async handleNewConversation(payload: ConversationNoteCreatedPayload): Promise<void> {
		this.plugin.insertConversationLink(
			payload.view,
			payload.from,
			payload.to,
			payload.title,
			payload.commandType,
			payload.commandContent,
			payload.lang
		);
	}

	private async handleConversationCommand(
		payload: ConversationCommandReceivedPayload
	): Promise<void> {
		const commandContent = payload.commandContent;

		switch (payload.commandType) {
			case 'calc': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.calculating')
				);
				await this.handleMathCalculation(payload.title, commandContent);
				break;
			}

			case 'image': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.generatingImage')
				);
				await this.mediaGenerationService.handleMediaCommand({
					title: payload.title,
					commandContent,
					commandType: 'image',
				});
				break;
			}

			case 'audio': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.generatingAudio')
				);
				await this.mediaGenerationService.handleMediaCommand({
					title: payload.title,
					commandContent,
					commandType: 'audio',
				});
				break;
			}

			case 'move': {
				await this.renderer.addGeneratingIndicator(payload.title, i18next.t('conversation.moving'));
				await this.handleMoveCommand(payload.title, commandContent);
				break;
			}

			case 'move_from_search_result': {
				await this.renderer.addGeneratingIndicator(payload.title, i18next.t('conversation.moving'));
				await this.handleMoveFromSearchResultCommand(payload.title, commandContent);
				break;
			}

			case 'delete': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.deleting')
				);
				await this.handleDeleteCommand(payload.title, commandContent);
				break;
			}

			case 'copy': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.copying')
				);
				await this.handleCopyCommand(payload.title, commandContent);
				break;
			}

			case 'search': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.searching')
				);
				await this.handleSearchCommand(payload.title, commandContent);
				break;
			}

			case 'more': {
				await this.handleShowMore(payload.title);
				break;
			}

			case 'close': {
				await this.handleCloseCommand(payload.title);
				break;
			}

			case 'confirm': {
				await this.handleConfirmCommand(payload.title, commandContent, payload.lang);
				break;
			}

			case 'revert': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.reverting')
				);
				await this.handleRevertCommand(payload.title, payload.lang);
				break;
			}

			case 'yes': {
				await this.handleConfirmCommand(payload.title, 'Yes', payload.lang);
				break;
			}

			case 'no': {
				await this.handleConfirmCommand(payload.title, 'No', payload.lang);
				break;
			}

			case ' ': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.workingOnIt')
				);
				await this.handleGeneralCommand(payload.title, commandContent);
				break;
			}

			case 'update': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.updating')
				);
				await this.handleUpdateCommand(payload.title, commandContent);
				break;
			}

			case 'update_from_search_result': {
				await this.renderer.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.updating')
				);
				await this.handleUpdateFromSearchResultCommand(payload.title, commandContent);
				break;
			}

			default:
				break;
		}
	}

	private async handleConversationLinkInserted(
		payload: ConversationLinkInsertedPayload
	): Promise<void> {
		switch (payload.commandType) {
			case 'calc': {
				await this.handleMathCalculation(payload.title, payload.commandContent);
				break;
			}

			case 'image': {
				await this.mediaGenerationService.handleMediaCommand({
					title: payload.title,
					commandContent: payload.commandContent,
					commandType: 'image',
				});
				break;
			}

			case 'audio': {
				await this.mediaGenerationService.handleMediaCommand({
					title: payload.title,
					commandContent: payload.commandContent,
					commandType: 'audio',
				});
				break;
			}

			case 'move': {
				await this.handleMoveCommand(payload.title, payload.commandContent);
				break;
			}

			case 'move_from_search_result': {
				await this.handleMoveFromSearchResultCommand(payload.title, payload.commandContent);
				break;
			}

			case 'search': {
				await this.handleSearchCommand(payload.title, payload.commandContent);
				break;
			}

			case 'more': {
				await this.handleShowMore(payload.title);
				break;
			}

			case 'close': {
				await this.handleCloseCommand(payload.title);
				break;
			}

			case 'confirm': {
				await this.handleConfirmCommand(payload.title, payload.commandContent, payload.lang);
				break;
			}

			case ' ': {
				await this.handleGeneralCommand(payload.title, payload.commandContent);
				break;
			}

			case 'delete': {
				await this.handleDeleteCommand(payload.title, payload.commandContent);
				break;
			}

			case 'copy': {
				await this.handleCopyCommand(payload.title, payload.commandContent);
				break;
			}

			case 'update': {
				await this.handleUpdateCommand(payload.title, payload.commandContent);
				break;
			}

			case 'update_from_search_result': {
				await this.handleUpdateFromSearchResultCommand(payload.title, payload.commandContent);
				break;
			}

			default:
				break;
		}
	}

	private async handleMathCalculation(title: string, commandContent: string): Promise<void> {
		try {
			const { toolName, firstNumber, secondNumber, answerTemplate } =
				await mathTools.selectMathTool(commandContent);
			const result = mathTools.executeToolByName(toolName, firstNumber, secondNumber);
			const answer = answerTemplate
				.replace('{result}', result.toString())
				.replace('{firstNumber}', firstNumber.toString())
				.replace('{secondNumber}', secondNumber.toString());
			await this.renderer.updateConversationNote({
				path: title,
				newContent: answer,
				role: 'Steward',
				command: 'calc',
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: error.message,
			});
		}
	}

	private async handleMoveCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Extract the move query
			const queryExtraction = await extractMoveQueryV2({
				userInput: commandContent,
				llmConfig: this.plugin.settings.llm,
			});

			// Get translation function for the specified language
			const t = getTranslation(queryExtraction.lang);

			// Explain the move query to the user
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*${queryExtraction.explanation}*`,
			});

			if (queryExtraction.confidence < 0.7) {
				return;
			}

			const filesByOperation = new Map<number, IndexedDocument[]>();
			for (let i = 0; i < queryExtraction.operations.length; i++) {
				const operation = queryExtraction.operations[i];
				const docs = await this.plugin.searchIndexer.searchV2([operation]);
				filesByOperation.set(i, docs);
			}

			// Count total files to move
			let totalFilesToMove = 0;
			filesByOperation.forEach(files => {
				totalFilesToMove += files.length;
			});

			// If no files match, inform the user without asking for confirmation
			if (totalFilesToMove === 0) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('common.noFilesFound'),
					role: 'Steward',
					command: 'move',
				});
				return;
			}

			// Check all destination folders
			const missingFolders = [];
			for (const operation of queryExtraction.operations) {
				if (
					operation.destinationFolder &&
					!this.plugin.app.vault.getAbstractFileByPath(operation.destinationFolder)
				) {
					missingFolders.push(operation.destinationFolder);
				}
			}

			// If there are missing folders, request confirmation
			if (missingFolders.length > 0) {
				// Create confirmation message
				let message = t('move.createFoldersHeader') + '\n';
				missingFolders.forEach(folder => {
					message += `- \`${folder}\`\n`;
				});
				message += '\n' + t('move.createFoldersQuestion');

				// Include filesByOperation and language in the context to avoid redundant queries
				await this.plugin.confirmationEventHandler.requestConfirmation(
					title,
					'move-folders',
					message,
					{
						missingFolders,
						queryExtraction,
						filesByOperation,
						lang: queryExtraction.lang,
					},
					{
						eventType: Events.MOVE_QUERY_EXTRACTED,
						payload: {
							title,
							queryExtraction,
							filesByOperation,
						},
					}
				);

				return; // Exit early, will resume when user responds
			}

			// If all folders exist, handle the move operation directly
			const payload: MoveQueryExtractedPayload = {
				title,
				queryExtraction,
				filesByOperation,
			};

			// Handle the move operation directly
			this.handleMoveOperation(payload);
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error extracting move query: ${error.message}*`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Handles the move operations from both query extraction and search results
	 * @param payload The event payload containing either move query extraction or search results
	 */
	private async handleMoveOperation(
		payload: MoveQueryExtractedPayload | MoveFromSearchResultConfirmedPayload
	): Promise<void> {
		try {
			// Add generating indicator
			await this.renderer.addGeneratingIndicator(payload.title, i18next.t('conversation.moving'));

			// Create operations array and filesByOperation map based on payload type
			const operations: MoveOperationV2[] = [];

			const filesByOperation = new Map<number, IndexedDocument[]>();

			// Handle based on the payload type
			if ('queryExtraction' in payload) {
				// It's a MoveQueryExtractedPayload
				const { queryExtraction, filesByOperation: existingFiles } = payload;

				// If we have files by operation, use them
				if (existingFiles) {
					// Add each operation from the query extraction
					operations.push(...queryExtraction.operations);

					// Copy the files for each operation
					queryExtraction.operations.forEach((_, index) => {
						const files = existingFiles.get(index) || [];
						filesByOperation.set(index, files);
					});
				} else {
					// Need to search for files first
					for (let i = 0; i < queryExtraction.operations.length; i++) {
						operations.push(queryExtraction.operations[i]);

						// Search for files matching this operation
						const docs = await this.plugin.searchIndexer.searchV2([queryExtraction.operations[i]]);
						filesByOperation.set(i, docs);
					}
				}
			} else {
				// It's a MoveFromSearchResultConfirmedPayload
				const { destinationFolder, searchResults, explanation } = payload;

				// Create a single operation
				operations.push({
					keywords: [explanation],
					tags: [],
					filenames: [],
					folders: [],
					destinationFolder,
				});

				// Set the files for this operation
				filesByOperation.set(0, searchResults);
			}

			// If there are no operations, return
			if (operations.length === 0) {
				await this.renderer.updateConversationNote({
					path: payload.title,
					newContent: 'No files to move',
					role: 'Steward',
				});
				return;
			}

			// Perform the move operations
			const result = await this.plugin.obsidianAPITools.moveByOperations(
				operations,
				filesByOperation
			);

			// Delete the search artifact (if any) after moving.
			const lastSearchMetadata = await this.renderer.findMostRecentMessageMetadata(
				payload.title,
				'search',
				'user'
			);

			if (
				lastSearchMetadata &&
				this.artifactManager.deleteArtifact(payload.title, lastSearchMetadata.ID)
			) {
				logger.log('Search results artifact deleted successfully.');
			}

			// Get the language from the payload if available
			const lang = 'queryExtraction' in payload ? payload.queryExtraction.lang : undefined;

			// Format the results
			const response = this.formatMoveResult({
				operations: result.operations,
				lang,
			});

			// Emit the move operation completed event after the operation is done
			eventEmitter.emit(Events.MOVE_OPERATION_COMPLETED, {
				title: payload.title,
				operations: result.operations,
			});

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path: payload.title,
				newContent: response,
				role: 'Steward',
				command: 'move',
			});
		} catch (error) {
			console.error('Error handling move operation:', error);
			await this.renderer.updateConversationNote({
				path: payload.title,
				newContent: `*Error moving files: ${error.message}*`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Format search results into a markdown string for display
	 * @param options Options for formatting search results
	 * @returns Formatted search results as a string
	 */
	private async formatSearchResults(options: {
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
			response += `\n\n**${displayIndex}.** [[${result.fileName}]]:\n`;

			// Get the file content directly
			const file = this.plugin.getFileByNameOrPath(result.fileName);

			if (file && 'keywordsMatched' in result) {
				try {
					const fileContent = await this.plugin.app.vault.cachedRead(file);

					// Get highlighted matches from the entire file content
					const highlightedMatches = highlightKeywords(
						result.keywordsMatched as string[],
						fileContent
					);

					// Show up to 3 highlighted matches
					const matchesToShow = Math.min(3, highlightedMatches.length);

					if (matchesToShow > 0) {
						// Add each highlighted match to the response
						for (let i = 0; i < matchesToShow; i++) {
							response += `\n"""\n${highlightedMatches[i]}\n"""\n`;
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

	private async handleSearchCommand(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<boolean> {
		try {
			const queryExtraction = await extractSearchQueryV2({
				userInput: commandContent,
				llmConfig: this.plugin.settings.llm,
				lang,
			});

			// Get the search results
			const docs = await this.plugin.searchIndexer.searchV2(queryExtraction.operations);

			// Paginate the results for display (first page)
			const paginatedDocs = this.plugin.searchIndexer.paginateResults(docs, 1, 10);

			// Format the search results
			const response = await this.formatSearchResults({
				paginatedDocs,
				headerText: queryExtraction.explanation,
				lang: queryExtraction.lang,
			});

			// Update the conversation note and get the message ID
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response,
				role: 'Steward',
				command: 'search',
			});

			const stewardSearchMetadata = await this.renderer.findMostRecentMessageMetadata(
				title,
				'search',
				'steward'
			);

			// Store the search results in the artifact manager
			if (stewardSearchMetadata) {
				this.artifactManager.storeArtifact(title, stewardSearchMetadata.ID, {
					type: ArtifactType.SEARCH_RESULTS,
					originalResults: docs,
				});
			}

			return true;
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error: ${error.message}*`,
			});

			return false;
		}
	}

	private async handleShowMore(path: string): Promise<void> {
		try {
			const userSearchMetadata = await this.renderer.findMostRecentMessageMetadata(
				path,
				'search',
				'user'
			);

			if (!userSearchMetadata) {
				await this.renderer.updateConversationNote({
					path,
					newContent: i18next.t('search.noRecentSearch'),
				});
				return;
			}

			const moreCommandMetadata = await this.renderer.findMostRecentMessageMetadata(
				path,
				'more',
				'user'
			);

			// Default to page 2 if this is the first "more" command
			const page = moreCommandMetadata ? parseInt(moreCommandMetadata.PAGE) : 2;

			// Retrieve the search results from the artifact manager
			const searchArtifact = this.artifactManager.getArtifact<SearchResultsArtifact>(
				path,
				userSearchMetadata.ID
			);

			if (!searchArtifact || searchArtifact.type !== ArtifactType.SEARCH_RESULTS) {
				await this.renderer.updateConversationNote({
					path,
					newContent: i18next.t('search.noRecentSearch'),
				});
				return;
			}

			// Get paginated results for the current page
			const paginatedDocs = this.plugin.searchIndexer.paginateResults(
				searchArtifact.originalResults,
				page,
				10
			);

			// If we're past the last page, inform the user
			if (page > paginatedDocs.totalPages) {
				await this.renderer.updateConversationNote({
					path,
					newContent: i18next.t('search.noMoreResults'),
					role: 'Steward',
				});
				return;
			}

			// Format the results
			const response = await this.formatSearchResults({
				paginatedDocs,
				page,
			});

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path,
				newContent: response,
				role: 'Steward',
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path,
				newContent: `*Error: ${error.message}*`,
			});
		}
	}

	/**
	 * Handles the general command by extracting the intent and routing to the appropriate handler
	 * @param title The conversation title
	 * @param commandContent The command content
	 */
	private async handleGeneralCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Extract the command intent using AI
			const intentExtraction = await extractCommandIntent(commandContent, {
				...this.plugin.settings.llm,
			});

			// Emit event to trigger the appropriate command handler
			eventEmitter.emit(Events.COMMAND_INTENT_EXTRACTED, {
				title,
				intentExtraction,
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error: ${error.message}*`,
			});
		}
	}

	/**
	 * Handles the closing of a conversation based on title
	 * @param title The title of the conversation
	 * @param lang Optional language code for the response
	 */
	private async handleCloseCommand(title: string): Promise<void> {
		try {
			// Directly close the conversation without updating the note
			await this.plugin.closeConversation(title);
		} catch (error) {
			console.error('Error closing conversation:', error);
		}
	}

	/**
	 * Handles the command intent extracted event
	 * @param payload The event payload containing the command intent extraction
	 */
	private async handleCommandIntentExtracted(
		payload: CommandIntentExtractedPayload
	): Promise<void> {
		const { title, intentExtraction } = payload;

		try {
			// For low confidence intents, just show the explanation without further action
			if (intentExtraction.confidence <= 0.7) {
				logger.log('low confidence intent', intentExtraction);
				await this.renderer.updateConversationNote({
					path: title,
					newContent: intentExtraction.explanation,
					role: 'Steward',
				});
				return;
			}

			// Update the command in the last user message comment block before routing
			await this.renderer.updateLastUserMessageCommand(title, intentExtraction.commandType);

			// For confident intents, route to the appropriate handler
			eventEmitter.emit(Events.CONVERSATION_COMMAND_RECEIVED, {
				title,
				commandType: intentExtraction.commandType,
				commandContent: intentExtraction.content,
				lang: intentExtraction.lang,
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error processing your request: ${error.message}*`,
			});
		}
	}

	/**
	 * Handle a direct confirmation command from the user
	 * @param title The conversation title
	 * @param commandContent The confirmation content
	 * @param lang The language code (optional)
	 */
	private async handleConfirmCommand(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		// Get the appropriate translation function, using the provided language or defaulting to English
		const t = getTranslation(lang);

		// First check if the message is a clear confirmation response
		const confirmationIntent = this.plugin.confirmationEventHandler.isConfirmIntent(commandContent);
		if (!confirmationIntent) {
			// If it's not a clear confirmation, let the user know
			await this.renderer.updateConversationNote({
				path: title,
				newContent: t('confirmation.notUnderstood'),
				role: 'Steward',
			});
			return;
		}

		// Find confirmations for this conversation
		const confirmationsForConversation =
			this.plugin.confirmationEventHandler.getPendingConfirmationsForConversation(title);

		if (confirmationsForConversation.length === 0) {
			// No pending confirmations for this conversation
			await this.renderer.updateConversationNote({
				path: title,
				newContent: t('confirmation.noPending'),
				role: 'Steward',
				command: 'confirm',
			});
			return;
		}

		// Get the oldest confirmation for this conversation
		const confirmation = confirmationsForConversation.sort((a, b) => a.createdAt - b.createdAt)[0];

		// If it's a clear confirmation response, emit the event
		eventEmitter.emit(Events.CONFIRMATION_RESPONDED, {
			id: confirmation.id,
			confirmed: confirmationIntent.isAffirmative,
			conversationTitle: title,
		});
	}

	// Helper to parse just the destination from the move command
	private parseMoveDestination(command: string): string {
		if (command.includes(' to ')) {
			const parts = command.split(' to ');
			return parts.pop()?.trim() || '';
		}
		return '';
	}

	// Format move results for display
	private formatMoveResult(result: {
		operations: Array<{
			sourceQuery: string;
			destinationFolder: string;
			moved: string[];
			errors: string[];
			skipped: string[];
		}>;
		lang?: string;
	}): string {
		const { operations, lang } = result;

		// Get translation function for the specified language
		const t = getTranslation(lang);

		// Single operation format
		if (operations.length === 1) {
			const { moved, errors, skipped } = operations[0];
			const totalCount = moved.length + errors.length + skipped.length;

			let response = t('move.foundFiles', { count: totalCount });

			if (moved.length > 0) {
				response += `\n\n**${t('move.successfullyMoved', { count: moved.length })}**`;
				moved.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (skipped.length > 0) {
				response += `\n\n**${t('move.skipped', { count: skipped.length })}**`;
				skipped.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (errors.length > 0) {
				response += `\n\n**${t('move.failed', { count: errors.length })}**`;
				errors.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			return response;
		}

		// Multiple operations format
		let response = t('move.multiMoveHeader', { count: operations.length });

		// For each operation, show the details
		operations.forEach((operation, index) => {
			const { sourceQuery, destinationFolder, moved, errors, skipped } = operation;
			const totalCount = moved.length + errors.length + skipped.length;

			response += `\n\n**${t('move.operation', {
				num: index + 1,
				query: sourceQuery,
				folder: destinationFolder,
			})}**`;

			if (totalCount === 0) {
				response += `\n\n${t('search.noResults')}`;
				return;
			}

			if (moved.length > 0) {
				response += `\n\n**${t('move.successfullyMoved', { count: moved.length })}**`;
				moved.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (skipped.length > 0) {
				response += `\n\n**${t('move.skipped', { count: skipped.length })}**`;
				skipped.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (errors.length > 0) {
				response += `\n\n**${t('move.failed', { count: errors.length })}**`;
				errors.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}
		});

		return response;
	}

	private handleError(payload: any): void {
		console.error('Error in conversation handling:', payload);
		// TODO: Implement error handling UI feedback
	}

	/**
	 * Handles the move_from_search_result command to move files from recent search results
	 * @param title The conversation title
	 * @param commandContent The command content containing the destination folder
	 */
	private async handleMoveFromSearchResultCommand(
		title: string,
		commandContent: string
	): Promise<void> {
		try {
			// Extract the destination folder from the command
			const extraction = await extractMoveFromSearchResult(commandContent);

			// Get translation function
			const t = getTranslation(extraction.lang);

			// Retrieve the most recent search results artifact
			const searchArtifact =
				this.artifactManager.getMostRecentArtifactByType<SearchResultsArtifact>(
					title,
					ArtifactType.SEARCH_RESULTS
				);

			if (!searchArtifact || searchArtifact.type !== ArtifactType.SEARCH_RESULTS) {
				// No search results available
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('search.noRecentSearch'),
					role: 'Steward',
				});
				return;
			}

			// Check if the destination folder exists
			const destinationFolder = extraction.destinationFolder;
			const folderExists = this.plugin.app.vault.getAbstractFileByPath(destinationFolder);

			if (!folderExists) {
				// Request confirmation to create the folder
				let message = t('move.createFoldersHeader') + '\n';
				message += `- \`${destinationFolder}\`\n`;
				message += '\n' + t('move.createFoldersQuestion');

				// Create context with information needed to perform the move after confirmation
				await this.plugin.confirmationEventHandler.requestConfirmation(
					title,
					'move-folder-from-search',
					message,
					{
						missingFolder: destinationFolder,
						searchResults: searchArtifact.originalResults,
						explanation: extraction.explanation,
					},
					{
						eventType: Events.MOVE_FROM_SEARCH_RESULT_CONFIRMED,
						payload: {
							title,
							destinationFolder,
							searchResults: searchArtifact.originalResults,
							explanation: extraction.explanation,
						},
					}
				);

				return; // Wait for confirmation
			}

			// Folder exists, create the payload and trigger the event directly
			const payload: MoveFromSearchResultConfirmedPayload = {
				title,
				destinationFolder,
				searchResults: searchArtifact.originalResults,
				explanation: extraction.explanation,
			};

			// Handle the move operation directly instead of emitting an event
			this.handleMoveOperation(payload);
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `Error extracting destination: ${error.message}`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Handle the revert command
	 * @param title The conversation title
	 */
	private async handleRevertCommand(title: string, lang?: string): Promise<void> {
		try {
			const gitEventHandler = this.plugin.gitEventHandler;
			const t = getTranslation(lang);

			// Revert the last operation
			const success = await gitEventHandler.revertLastOperation();

			// Update the conversation with the result
			if (success) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('conversation.revertSuccess'),
					role: 'Steward',
				});
			} else {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('conversation.revertFailed'),
					role: 'Steward',
				});
			}
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error reverting changes: ${error.message}*`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Handles the delete command to delete files matching search criteria
	 * @param title The conversation title
	 * @param commandContent The command content
	 */
	private async handleDeleteCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Extract the search query
			const queryExtraction = await extractSearchQueryV2({
				userInput: commandContent,
				llmConfig: this.plugin.settings.llm,
			});

			// Explain the search query to the user
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*${queryExtraction.explanation}*`,
			});

			// Get translation function
			const t = getTranslation(queryExtraction.lang);

			// Search for files matching the criteria
			const docs = await this.plugin.searchIndexer.searchV2(queryExtraction.operations);

			// If no files match, inform the user
			if (docs.length === 0) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('common.noFilesFound'),
					role: 'Steward',
					command: 'delete',
				});
				return;
			}

			// Delete the files directly
			const deletedFiles: string[] = [];
			const failedFiles: string[] = [];

			for (const doc of docs) {
				try {
					const file = this.plugin.app.vault.getAbstractFileByPath(doc.path);
					if (file) {
						await this.plugin.app.vault.delete(file);
						deletedFiles.push(doc.path);
					}
				} catch (error) {
					failedFiles.push(doc.path);
				}
			}

			// Format the results
			let response = t('delete.foundFiles', { count: docs.length });

			if (deletedFiles.length > 0) {
				response += `\n\n**${t('delete.successfullyDeleted', { count: deletedFiles.length })}**`;
				deletedFiles.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (failedFiles.length > 0) {
				response += `\n\n**${t('delete.failed', { count: failedFiles.length })}**`;
				failedFiles.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response,
				role: 'Steward',
				command: 'delete',
			});

			// Emit the delete operation completed event
			eventEmitter.emit(Events.DELETE_OPERATION_COMPLETED, {
				title,
				operations: [
					{
						sourceQuery: commandContent,
						deleted: deletedFiles,
						errors: failedFiles,
					},
				],
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error extracting delete query: ${error.message}*`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Handles the copy command to copy files matching search criteria to a destination
	 * @param title The conversation title
	 * @param commandContent The command content
	 */
	private async handleCopyCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Extract the search query and destination
			const queryExtraction = await extractSearchQueryV2({
				userInput: commandContent,
				llmConfig: this.plugin.settings.llm,
			});

			// Explain the search query to the user
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*${queryExtraction.explanation}*`,
			});

			// Get translation function
			const t = getTranslation(queryExtraction.lang);

			// Search for files matching the criteria
			const docs = await this.plugin.searchIndexer.searchV2(queryExtraction.operations);

			// If no files match, inform the user
			if (docs.length === 0) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('common.noFilesFound'),
					role: 'Steward',
					command: 'copy',
				});
				return;
			}

			// Convert search operations to move operations for copying
			const moveOperations: MoveOperationV2[] = queryExtraction.operations.map(op => ({
				...op,
				destinationFolder: (op as any).destinationFolder || '',
			}));

			// Check if the destination folder exists
			const destinationFolder = moveOperations[0].destinationFolder;
			if (!destinationFolder) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: i18next.t('copy.noDestination'),
					role: 'Steward',
					command: 'copy',
				});
				return;
			}

			const folderExists = this.plugin.app.vault.getAbstractFileByPath(destinationFolder);

			if (!folderExists) {
				// Request confirmation to create the folder
				let message = i18next.t('copy.createFoldersHeader') + '\n';
				message += `- \`${destinationFolder}\`\n`;
				message += '\n' + i18next.t('copy.createFoldersQuestion');

				// Request confirmation
				await this.plugin.confirmationEventHandler.requestConfirmation(
					title,
					'copy-folder',
					message,
					{
						missingFolder: destinationFolder,
						queryExtraction,
						docs,
					},
					{
						eventType: Events.COPY_OPERATION_CONFIRMED,
						payload: {
							title,
							queryExtraction,
							docs,
						},
					}
				);

				return; // Wait for confirmation
			}

			// Create a map of files by operation
			const filesByOperation = new Map<number, IndexedDocument[]>();
			filesByOperation.set(0, docs);

			// Perform the copy operation
			const result = await this.plugin.obsidianAPITools.copyByOperations(
				moveOperations,
				filesByOperation
			);

			// Format the results
			const response = this.formatCopyResult({
				operations: result.operations,
				lang: queryExtraction.lang,
			});

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response,
				role: 'Steward',
				command: 'copy',
			});

			// Emit the copy operation completed event
			eventEmitter.emit(Events.COPY_OPERATION_COMPLETED, {
				title,
				operations: result.operations,
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error extracting copy query: ${error.message}*`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Format copy results for display
	 */
	private formatCopyResult(result: {
		operations: Array<{
			sourceQuery: string;
			destinationFolder: string;
			copied: string[];
			errors: string[];
			skipped: string[];
		}>;
		lang?: string;
	}): string {
		const { operations, lang } = result;

		// Get translation function for the specified language
		const t = getTranslation(lang);

		// Single operation format
		if (operations.length === 1) {
			const { copied, errors, skipped } = operations[0];
			const totalCount = copied.length + errors.length + skipped.length;

			let response = t('copy.foundFiles', { count: totalCount });

			if (copied.length > 0) {
				response += `\n\n**${t('copy.successfullyCopied', { count: copied.length })}**`;
				copied.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (skipped.length > 0) {
				response += `\n\n**${t('copy.skipped', { count: skipped.length })}**`;
				skipped.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (errors.length > 0) {
				response += `\n\n**${t('copy.failed', { count: errors.length })}**`;
				errors.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			return response;
		}

		// Multiple operations format
		let response = t('copy.multiCopyHeader', { count: operations.length });

		// For each operation, show the details
		operations.forEach((operation, index) => {
			const { sourceQuery, destinationFolder, copied, errors, skipped } = operation;
			const totalCount = copied.length + errors.length + skipped.length;

			response += `\n\n**${t('copy.operation', {
				num: index + 1,
				query: sourceQuery,
				folder: destinationFolder,
			})}**`;

			if (totalCount === 0) {
				response += `\n\n${t('search.noResults')}`;
				return;
			}

			if (copied.length > 0) {
				response += `\n\n**${t('copy.successfullyCopied', { count: copied.length })}**`;
				copied.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (skipped.length > 0) {
				response += `\n\n**${t('copy.skipped', { count: skipped.length })}**`;
				skipped.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (errors.length > 0) {
				response += `\n\n**${t('copy.failed', { count: errors.length })}**`;
				errors.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}
		});

		return response;
	}

	private async handleUpdateCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Extract the sequence of commands needed
			const extraction = await extractUpdateCommand({
				userInput: commandContent,
				llmConfig: this.plugin.settings.llm,
			});

			const t = getTranslation(extraction.lang);

			// Process each command in sequence
			for (const command of extraction.commands) {
				switch (command.type) {
					case 'search': {
						await this.renderer.addGeneratingIndicator(title, t('conversation.searching'));
						if (!(await this.handleSearchCommand(title, command.content, extraction.lang))) {
							return;
						}
						break;
					}
					case 'update_from_search_result': {
						await this.renderer.addGeneratingIndicator(title, t('conversation.updating'));
						await this.handleUpdateFromSearchResultCommand(title, command.content, extraction.lang);
						break;
					}
				}
			}
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error extracting update command: ${error.message}*`,
			});
		}
	}

	private async handleUpdateFromSearchResultCommand(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		try {
			const t = getTranslation(lang);
			// Retrieve the most recent search results artifact
			const searchArtifact =
				this.artifactManager.getMostRecentArtifactByType<SearchResultsArtifact>(
					title,
					ArtifactType.SEARCH_RESULTS
				);

			if (!searchArtifact || searchArtifact.type !== ArtifactType.SEARCH_RESULTS) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('search.noRecentSearch'),
					role: 'Steward',
				});
				return;
			}

			// Extract the update instruction
			const extraction = await extractUpdateFromSearchResult({
				userInput: commandContent,
				llmConfig: this.plugin.settings.llm,
			});

			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*${extraction.explanation}*`,
			});

			if (extraction.confidence <= 0.7) {
				return;
			}

			// Perform the update
			await this.handleUpdateFromSearchResult(title, extraction.updateInstruction, extraction.lang);
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `Error extracting update instruction: ${error.message}`,
				role: 'Steward',
			});
		}
	}

	private async handleUpdateFromSearchResult(
		title: string,
		updateInstruction: UpdateInstruction,
		lang?: string
	): Promise<void> {
		try {
			// Get translation function
			const t = getTranslation(lang);

			// Retrieve the most recent search results artifact
			const searchArtifact =
				this.artifactManager.getMostRecentArtifactByType<SearchResultsArtifact>(
					title,
					ArtifactType.SEARCH_RESULTS
				);

			if (!searchArtifact || searchArtifact.type !== ArtifactType.SEARCH_RESULTS) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('search.noRecentSearch'),
					role: 'Steward',
				});
				return;
			}

			// Perform the updates
			const updatedFiles: string[] = [];
			const failedFiles: string[] = [];
			const skippedFiles: string[] = [];

			for (const doc of searchArtifact.originalResults) {
				try {
					const file = this.plugin.app.vault.getAbstractFileByPath(doc.path);
					if (file && file instanceof TFile) {
						// Read the file content
						const content = await this.plugin.app.vault.read(file);

						// Apply the update instruction
						const updatedContent = await this.plugin.obsidianAPITools.applyUpdateInstruction(
							content,
							updateInstruction
						);

						if (updatedContent === content) {
							skippedFiles.push(doc.path);
							continue;
						}

						// Write the updated content back
						await this.plugin.app.vault.modify(file, updatedContent);
						updatedFiles.push(doc.path);
					}
				} catch (error) {
					failedFiles.push(doc.path);
				}
			}

			// Format the results
			let response = t('update.foundFiles', { count: searchArtifact.originalResults.length });

			if (updatedFiles.length > 0) {
				response += `\n\n**${t('update.successfullyUpdated', { count: updatedFiles.length })}**`;
				updatedFiles.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (skippedFiles.length > 0) {
				response += `\n\n**${t('update.skipped', { count: skippedFiles.length })}**`;
				skippedFiles.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			if (failedFiles.length > 0) {
				response += `\n\n**${t('update.failed', { count: failedFiles.length })}**`;
				failedFiles.forEach(file => {
					response += `\n- [[${file}]]`;
				});
			}

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response,
				role: 'Steward',
				command: 'update',
			});

			// Emit the update operation completed event
			eventEmitter.emit(Events.UPDATE_OPERATION_COMPLETED, {
				title,
				operations: [
					{
						updateInstruction: JSON.stringify(updateInstruction),
						updated: updatedFiles,
						skipped: skippedFiles,
						errors: failedFiles,
					},
				],
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error updating files: ${error.message}*`,
				role: 'Steward',
			});
		}
	}
}
