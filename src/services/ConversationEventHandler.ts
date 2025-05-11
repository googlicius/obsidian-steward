import {
	Events,
	ErrorEvents,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationCommandReceivedPayload,
	CommandIntentExtractedPayload,
	MoveFromSearchResultConfirmedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import * as mathTools from '../tools/mathTools';
import StewardPlugin from '../main';
import i18next, { getTranslation } from '../i18n';
import { highlightKeywords } from '../utils/highlightKeywords';
import { extractCommandIntent, extractSearchQueryV2 } from '../lib/modelfusion';
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
import { extractDestinationFolder } from 'src/lib/modelfusion/destinationFolderExtraction';
import { MoveOperationV2 } from 'src/tools/obsidianAPITools';
import { extractPromptCreation } from '../lib/modelfusion/promptCreationExtraction';
import { extractNoteCreation } from '../lib/modelfusion/noteCreationExtraction';
import { streamText } from 'modelfusion';
import { createLLMGenerator } from '../lib/modelfusion/llmConfig';
import { WorkspaceLeaf } from 'obsidian';
import { userLanguagePromptText } from 'src/lib/modelfusion/prompts/languagePrompt';

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
		for (const command of payload.commands) {
			switch (command.commandType) {
				case 'calc': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.calculating')
					);
					await this.handleMathCalculation(payload.title, command.content);
					break;
				}

				case 'image': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.generatingImage')
					);
					await this.mediaGenerationService.handleMediaCommand({
						title: payload.title,
						commandContent: command.content,
						commandType: 'image',
					});
					break;
				}

				case 'audio':
				case 'speak': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.generatingAudio')
					);
					await this.mediaGenerationService.handleMediaCommand({
						title: payload.title,
						commandContent: command.content,
						commandType: 'audio',
					});
					break;
				}

				case 'move_from_search_result': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.moving')
					);
					await this.handleMoveFromSearchResultCommand(payload.title, command.content);
					break;
				}

				case 'delete_from_search_result': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.deleting')
					);
					await this.handleDeleteCommand(payload.title, command.content);
					break;
				}

				case 'copy_from_search_result': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.copying')
					);
					await this.handleCopyCommand(payload.title, command.content);
					break;
				}

				case 'search': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.searching')
					);
					await this.handleSearchCommand(payload.title, command.content);
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
					await this.handleConfirmCommand(payload.title, command.content, payload.lang);
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
					await this.handleGeneralCommand(payload.title, command.content);
					break;
				}

				case 'update_from_search_result': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.updating')
					);
					await this.handleUpdateFromSearchResultCommand(
						payload.title,
						command.content,
						payload.lang
					);
					break;
				}

				case 'prompt': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.creatingPrompt')
					);
					await this.handlePromptCommand(payload.title, command.content, payload.lang);
					break;
				}

				case 'create': {
					await this.renderer.addGeneratingIndicator(
						payload.title,
						i18next.t('conversation.creating')
					);
					await this.handleCreateCommand(payload.title, command.content, payload.lang);
					break;
				}

				default:
					break;
			}
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

			case 'audio':
			case 'speak': {
				await this.mediaGenerationService.handleMediaCommand({
					title: payload.title,
					commandContent: payload.commandContent,
					commandType: 'audio',
				});
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

			case 'prompt': {
				await this.handlePromptCommand(payload.title, payload.commandContent, payload.lang);
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

	/**
	 * Handles the move operations from both query extraction and search results
	 * @param payload The event payload containing either move query extraction or search results
	 */
	private async handleMoveOperation(
		payload: MoveFromSearchResultConfirmedPayload,
		lang?: string
	): Promise<void> {
		try {
			// Add generating indicator
			await this.renderer.addGeneratingIndicator(payload.title, i18next.t('conversation.moving'));

			// Create operations array and filesByOperation map based on payload type
			const operations: MoveOperationV2[] = [];

			const filesByOperation = new Map<number, IndexedDocument[]>();

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
			const stewardSearchMetadata = await this.renderer.findMostRecentMessageMetadata(
				path,
				'search',
				'steward'
			);

			if (!stewardSearchMetadata) {
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
				stewardSearchMetadata.ID
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

			// For confident intents, route to the appropriate handler
			eventEmitter.emit(Events.CONVERSATION_COMMAND_RECEIVED, {
				title,
				commands: intentExtraction.commands,
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
	private async handleDeleteCommand(
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

			const docs = searchArtifact.originalResults;

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
				command: 'delete_from_search_result',
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
	private async handleCopyCommand(
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

			const docs = searchArtifact.originalResults;

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

			const extraction = await extractDestinationFolder(commandContent, this.plugin.settings.llm);

			// Convert search operations to move operations for copying
			const moveOperations: MoveOperationV2[] = docs.map(doc => ({
				...doc,
				destinationFolder: extraction.destinationFolder,
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
						queryExtraction: extraction,
						docs,
					},
					{
						eventType: Events.COPY_OPERATION_CONFIRMED,
						payload: {
							title,
							queryExtraction: extraction,
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
				lang: extraction.lang,
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

			// Extract the update instructions
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

			// Perform the updates
			await this.handleUpdateFromSearchResult(
				title,
				extraction.updateInstructions,
				extraction.lang
			);
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `Error extracting update instructions: ${error.message}`,
				role: 'Steward',
			});
		}
	}

	private async handleUpdateFromSearchResult(
		title: string,
		updateInstructions: UpdateInstruction[],
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
						let content = await this.plugin.app.vault.read(file);
						let contentChanged = false;

						// Apply each update instruction in sequence
						for (const instruction of updateInstructions) {
							const updatedContent = await this.plugin.obsidianAPITools.applyUpdateInstruction(
								content,
								instruction
							);

							if (updatedContent !== content) {
								content = updatedContent;
								contentChanged = true;
							}
						}

						if (!contentChanged) {
							skippedFiles.push(doc.path);
							continue;
						}

						// Write the updated content back
						await this.plugin.app.vault.modify(file, content);
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
						updateInstruction: JSON.stringify(updateInstructions),
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

	/**
	 * Handle the prompt creation command
	 * @param title The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code for the response
	 */
	private async handlePromptCommand(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		try {
			const t = getTranslation(lang);

			// Extract the prompt creation using the LLM
			const prompt = await extractPromptCreation(commandContent, this.plugin.settings.llm);

			// Format the response
			const response = [
				`**${t('prompt.created')}**`,
				'',
				`**${t('prompt.commandName')}**: ${prompt.commandName}`,
				`**${t('prompt.description')}**: ${prompt.description}`,
				'',
				`**${t('prompt.content')}**:`,
				'',
				prompt.content,
				'',
			];

			if (prompt.examples && prompt.examples.length > 0) {
				response.push('', `**${t('prompt.examples')}**:`);
				prompt.examples.forEach((example: string) => {
					response.push(`- ${example}`);
				});
			}

			// Update the conversation with the results
			await this.renderer.updateConversationNote({
				path: title,
				newContent: response.join('\n'),
				role: 'Steward',
				command: 'prompt',
			});
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error creating prompt: ${error.message}*`,
				role: 'Steward',
			});
		}
	}

	/**
	 * Handle the note creation command
	 * @param title The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code for the response
	 */
	private async handleCreateCommand(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		try {
			const t = getTranslation(lang);

			// Extract the note creation details using the LLM
			const extraction = await extractNoteCreation(commandContent, this.plugin.settings.llm);

			// For low confidence extractions, just show the explanation
			if (extraction.confidence <= 0.7) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: extraction.explanation,
					role: 'Steward',
				});
				return;
			}

			const newNotePath = extraction.noteName ? `${extraction.noteName}.md` : '';
			if (newNotePath) {
				await this.plugin.app.vault.create(newNotePath, '');

				// Add a link to the conversation note
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('create.creatingNote', { noteName: `[[${newNotePath}]]` }),
					role: 'Steward',
					command: 'create',
				});
			}

			if (extraction.contentSource === 'user-given') {
				if (newNotePath) {
					// For user-given content, write the extracted content directly to the note
					await this.plugin.app.vault.modify(
						this.plugin.app.vault.getAbstractFileByPath(newNotePath) as TFile,
						extraction.content
					);
				} else {
					await this.renderer.updateConversationNote({
						path: title,
						newContent: '*Note name is missing*',
						role: 'Steward',
						command: 'create',
					});
				}
			} else {
				// For generated content, stream the content generation
				const stream = await streamText({
					model: createLLMGenerator({ ...this.plugin.settings.llm, responseFormat: 'text' }),
					prompt: [
						{
							role: 'system',
							content: `You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content. Format the content in Markdown.							`,
						},
						{
							role: 'system',
							content: `The content should not include the big heading on the top.`,
						},
						userLanguagePromptText,
						{
							role: 'user',
							content: extraction.content,
						},
					],
				});

				if (newNotePath) {
					// Get the main leaf
					let mainLeaf: WorkspaceLeaf | undefined;
					this.plugin.app.workspace.iterateRootLeaves(leaf => {
						mainLeaf = leaf;
					});

					// Get the file reference
					const file = this.plugin.app.vault.getAbstractFileByPath(newNotePath) as TFile;

					// Open the file in the main leaf
					if (mainLeaf && file) {
						mainLeaf.openFile(file);
					}

					// Stream the content to the note
					let accumulatedContent = '';
					for await (const chunk of stream) {
						accumulatedContent += chunk;
						await this.plugin.app.vault.modify(file, accumulatedContent);
					}

					// Update the conversation with the results
					await this.renderer.updateConversationNote({
						path: title,
						newContent: `*${t('create.success', { noteName: extraction.noteName })}*`,
					});
				} else {
					// If noteName is missing, stream content to current conversation
					await this.renderer.streamConversationNote({
						path: title,
						stream,
						command: 'create',
					});
				}
			}
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error creating note: ${error.message}*`,
				role: 'Steward',
			});
		}
	}
}
