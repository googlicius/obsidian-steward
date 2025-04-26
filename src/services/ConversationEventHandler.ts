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
import StewardPlugin, { GeneratorText } from '../main';
import i18next, { getTranslation } from '../i18n';
import { highlightKeywords } from '../utils/highlightKeywords';
import { extractMoveQueryV2, extractSearchQueryV2, MoveOperationV2 } from '../lib/modelfusion';
import { IndexedDocument } from '../database/PluginDatabase';
import { ConversationRenderer } from './ConversationRenderer';
import {
	ArtifactType,
	ConversationArtifactManager,
	SearchResultsArtifact,
} from './ConversationArtifactManager';
import { extractMoveFromSearchResult } from '../lib/modelfusion';

interface Props {
	plugin: StewardPlugin;
}

export class ConversationEventHandler {
	private readonly plugin: StewardPlugin;
	private readonly renderer: ConversationRenderer;
	private readonly artifactManager: ConversationArtifactManager;

	constructor(props: Props) {
		this.plugin = props.plugin;
		this.renderer = new ConversationRenderer(this.plugin);
		this.artifactManager = ConversationArtifactManager.getInstance();
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

			case ' ': {
				await this.renderer.addGeneratingIndicator(payload.title, GeneratorText.ExtractingIntent);
				await this.handleGeneralCommand(payload.title, commandContent);
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
			const queryExtraction = await extractMoveQueryV2(commandContent);

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

			// Get translation function for the specified language
			const t = getTranslation(queryExtraction.lang);

			// If no files match, inform the user without asking for confirmation
			if (totalFilesToMove === 0) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('move.noFilesFound'),
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
			await this.renderer.addGeneratingIndicator(payload.title, GeneratorText.Moving);

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

			// Get the language from the payload if available
			const lang = 'queryExtraction' in payload ? payload.queryExtraction.lang : undefined;

			// Format the results
			const response = this.formatMoveResult({
				operations: result.operations,
				lang,
			});

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path: payload.title,
				newContent: response,
				role: 'Steward',
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

	private async handleSearchCommand(title: string, commandContent: string): Promise<void> {
		try {
			const queryExtraction = await extractSearchQueryV2(commandContent);

			// Get the search results
			const docs = await this.plugin.searchIndexer.searchV2(queryExtraction.operations);

			// Paginate the results for display (first page)
			const paginatedDocs = this.plugin.searchIndexer.paginateResults(docs, 1, 10);

			// Get translation function for the specified language
			const t = getTranslation(queryExtraction.lang);

			// Format the results
			let response = `${queryExtraction.explanation}\n\n`;

			// Add the search results count text
			if (paginatedDocs.totalCount > 0) {
				response += `${t('search.found', { count: paginatedDocs.totalCount })}`;

				// List the search results
				for (let index = 0; index < paginatedDocs.documents.length; index++) {
					const result = paginatedDocs.documents[index];
					response += `\n\n**${index + 1}.** [[${result.fileName}]]:\n`;

					// Get the file content directly instead of using result.matches
					const file = this.plugin.getFileByNameOrPath(result.fileName);

					if (file && 'keywordsMatched' in result) {
						try {
							const fileContent = await this.plugin.app.vault.cachedRead(file);

							// Get highlighted matches from the entire file content
							const highlightedMatches = highlightKeywords(result.keywordsMatched, fileContent);

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
							} else {
								// No highlights found in the file content
								response += `\n${t('search.noMatchesInFile')}\n`;
							}
						} catch (error) {
							console.error('Error reading file:', error);
						}
					}
				}

				// Add pagination information and more command if there are more results
				if (paginatedDocs.totalPages > 1) {
					response += `\n\n${t('search.useMoreCommand')}`;
				}
			} else {
				response += `${t('search.noResults')}`;
			}

			// Update the conversation note and get the message ID
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response,
				role: 'Steward',
			});

			const userSearchMetadata = await this.renderer.findMostRecentMessageMetadata(
				title,
				'search',
				'user'
			);

			// Store the search results in the artifact manager
			if (userSearchMetadata) {
				this.artifactManager.storeArtifact(title, userSearchMetadata.ID, {
					type: ArtifactType.SEARCH_RESULTS,
					originalResults: docs,
				});
			}
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error: ${error.message}*`,
			});
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
			const t = getTranslation();
			let response = `${t('search.showingPage', { page, total: paginatedDocs.totalPages })}\n\n`;

			// List the search results
			for (let index = 0; index < paginatedDocs.documents.length; index++) {
				const result = paginatedDocs.documents[index];
				const displayIndex = (page - 1) * 10 + index + 1;
				response += `\n\n**${displayIndex}.** [[${result.fileName}]]:\n`;

				// Get the file content directly instead of using result.matches
				const file = this.plugin.getFileByNameOrPath(result.fileName);

				if (file && 'keywordsMatched' in result) {
					try {
						const fileContent = await this.plugin.app.vault.cachedRead(file);

						// Get highlighted matches from the entire file content
						const highlightedMatches = highlightKeywords(result.keywordsMatched, fileContent);

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
						} else {
							// No highlights found in the file content
							response += `\n${t('search.noMatchesInFile')}\n`;
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
			const intentExtraction =
				await this.plugin.obsidianAPITools.extractCommandIntent(commandContent);

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
				command: 'confirm',
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
			const t = getTranslation();

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
					command: 'move_from_search_result',
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
				newContent: `*Error extracting destination: ${error.message}*`,
				role: 'Steward',
				command: 'move_from_search_result',
			});
		}
	}
}
