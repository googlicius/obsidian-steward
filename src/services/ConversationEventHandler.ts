import {
	Events,
	ErrorEvents,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationCommandReceivedPayload,
	MoveQueryExtractedPayload,
	CommandIntentExtractedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import * as mathTools from '../tools/mathTools';
import StewardPlugin, { GeneratorText } from '../main';
import i18next, { getTranslation } from '../i18n';
import { highlightKeywords } from '../utils/highlightKeywords';
import { extractSearchQueryV2 } from 'src/lib/modelfusion';

interface Props {
	plugin: StewardPlugin;
}

export class ConversationEventHandler {
	private readonly plugin: StewardPlugin;

	constructor(props: Props) {
		this.plugin = props.plugin;
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
			this.handleMoveQueryExtracted(payload);
		});

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
				await this.plugin.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.calculating')
				);
				await this.handleMathCalculation(payload.title, commandContent);
				break;
			}

			case 'move': {
				await this.plugin.addGeneratingIndicator(payload.title, i18next.t('conversation.moving'));
				await this.handleMoveCommand(payload.title, commandContent);
				break;
			}

			case 'search': {
				await this.plugin.addGeneratingIndicator(
					payload.title,
					i18next.t('conversation.searching')
				);
				await this.handleSearchCommand(payload.title, commandContent);
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
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.ExtractingIntent);
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

			case 'search': {
				await this.handleSearchCommand(payload.title, payload.commandContent);
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
			await this.plugin.updateConversationNote(title, answer, 'Steward');
		} catch (error) {
			await this.plugin.updateConversationNote(title, error.message, 'Steward');
		}
	}

	private async handleMoveCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Extract the move query
			const queryExtraction = await this.plugin.obsidianAPITools.extractMoveQuery(commandContent);
			// const extractedMoveQuery = await extractMoveQueryV2(commandContent);

			// console.log('extractedMoveQuery', extractedMoveQuery);

			// Get all files matching the source queries using the new function
			const filesByOperation =
				await this.plugin.obsidianAPITools.getFilesByMoveQueryExtraction(queryExtraction);

			// Count total files to move
			let totalFilesToMove = 0;
			filesByOperation.forEach(files => {
				totalFilesToMove += files.length;
			});

			// Get translation function for the specified language
			const t = getTranslation(queryExtraction.lang);

			// If no files match, inform the user without asking for confirmation
			if (totalFilesToMove === 0) {
				await this.plugin.updateConversationNote(title, t('move.noFilesFound'), 'Steward');
				return;
			}

			// Check all destination folders
			const missingFolders = [];
			for (const operation of queryExtraction.operations) {
				if (!this.plugin.app.vault.getAbstractFileByPath(operation.destinationFolder)) {
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
							queryExtraction, // This already contains the lang property if it was set
							filesByOperation, // Pass the retrieved files to avoid redundant queries
						},
					}
				);

				return; // Exit early, will resume when user responds
			}

			// All folders exist, continue with move
			eventEmitter.emit(Events.MOVE_QUERY_EXTRACTED, {
				title,
				queryExtraction,
				filesByOperation, // Pass the retrieved files to avoid redundant queries
			});
		} catch (error) {
			await this.plugin.updateConversationNote(
				title,
				`Error extracting move query: ${error.message}`,
				'Steward'
			);
		}
	}

	/**
	 * Handles the move query extracted event
	 * @param payload The event payload containing the move query extraction and optionally the files by operation
	 */
	private async handleMoveQueryExtracted(payload: MoveQueryExtractedPayload): Promise<void> {
		const { title, queryExtraction, filesByOperation } = payload;

		try {
			// Add generating indicator
			await this.plugin.addGeneratingIndicator(title, GeneratorText.Moving);

			// Perform the move operations, passing the files if available to avoid redundant queries
			const result = await this.plugin.obsidianAPITools.moveByQueryExtraction(
				queryExtraction,
				filesByOperation
			);

			// Format the results using the existing helper method
			const response = this.formatMoveResult({
				operations: result.operations,
				lang: queryExtraction.lang,
			});

			// Update the conversation with the results
			await this.plugin.updateConversationNote(title, response);
		} catch (error) {
			console.error('Error handling move query:', error);
			await this.plugin.updateConversationNote(
				title,
				`Error moving files: ${error.message}`,
				'Steward'
			);
		}
	}

	private async handleSearchCommand(title: string, commandContent: string): Promise<void> {
		try {
			const queryExtraction = await extractSearchQueryV2(commandContent);

			const results = await this.plugin.searchIndexer.searchV2(queryExtraction.operations);

			// Get translation function for the specified language
			const t = getTranslation(queryExtraction.lang);

			// Format the results
			let response = `${queryExtraction.explanation}\n\n`;

			// Add the search results count text
			if (results.totalCount > 0) {
				response += `${t('search.found', { count: results.totalCount })}`;

				// List the search results
				for (let index = 0; index < results.documents.length; index++) {
					const result = results.documents[index];
					response += `\n\n**${index + 1}.** [[${result.fileName}]]:\n`;

					// Get the file content directly instead of using result.matches
					const file = this.plugin.getFileByNameOrPath(result.fileName);

					if (file && 'keywordsMatched' in result) {
						try {
							const fileContent = await this.plugin.app.vault.read(file);

							// Get highlighted matches from the entire file content
							const highlightedMatches = highlightKeywords(result.keywordsMatched, fileContent);

							// Show up to 3 highlighted matches
							const matchesToShow = Math.min(3, highlightedMatches.length);

							if (matchesToShow > 0) {
								// Add each highlighted match to the response
								for (let i = 0; i < matchesToShow; i++) {
									response += `\n${highlightedMatches[i]}\n`;
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

				response += `\n\n${t('search.showMoreDetails')}`;
			} else {
				response += `${t('search.noResults')}`;
			}

			await this.plugin.updateConversationNote(title, response, 'Steward');
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`, 'Steward');
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
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`, 'Steward');
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
				await this.plugin.updateConversationNote(title, intentExtraction.explanation, 'Steward');
				return;
			}

			// For confident intents, route to the appropriate handler
			eventEmitter.emit(Events.CONVERSATION_COMMAND_RECEIVED, {
				title,
				commandType: intentExtraction.commandType,
				commandContent: intentExtraction.content,
				lang: intentExtraction.lang,
			});
		} catch (error) {
			await this.plugin.updateConversationNote(
				title,
				`Error processing your request: ${error.message}`
			);
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
			await this.plugin.updateConversationNote(title, t('confirmation.notUnderstood'), 'Steward');
			return;
		}

		// Find confirmations for this conversation
		const confirmationsForConversation =
			this.plugin.confirmationEventHandler.getPendingConfirmationsForConversation(title);

		if (confirmationsForConversation.length === 0) {
			// No pending confirmations for this conversation
			await this.plugin.updateConversationNote(title, t('confirmation.noPending'), 'Steward');
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

	private isMathExpression(content: string): boolean {
		// TODO: Implement more sophisticated math detection
		// For now, just check if it contains numbers and operators
		return /[\d+\-*/]/.test(content);
	}
}
