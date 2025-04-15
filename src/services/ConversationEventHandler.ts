import {
	Events,
	ErrorEvents,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationNoteUpdatedPayload,
	MoveQueryExtractedPayload,
	CommandIntentExtractedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import * as mathTools from 'src/tools/mathTools';
import StewardPlugin, { GeneratorText } from 'src/main';
import { getTranslation } from 'src/i18n';

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

		// Listen for conversation note updated
		eventEmitter.on(Events.CONVERSATION_NOTE_UPDATED, (payload: ConversationNoteUpdatedPayload) => {
			this.handleConversationNoteUpdated(payload);
		});

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

	private async handleConversationNoteUpdated(
		payload: ConversationNoteUpdatedPayload
	): Promise<void> {
		// We no longer need to check for the prefix since we've already displayed
		// the explanation in the handleCommandIntentExtracted function
		const commandContent = payload.commandContent;

		switch (payload.commandType) {
			case 'calc': {
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.Calculating);
				await this.handleMathCalculation(payload.title, commandContent);
				break;
			}

			case 'move': {
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.ExtractingMoveQuery);
				await this.handleMoveCommand(payload.title, commandContent);
				break;
			}

			case 'search': {
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.Searching);
				await this.handleSearchCommand(payload.title, commandContent);
				break;
			}

			case 'close': {
				await this.handleCloseCommand(payload.title);
				break;
			}

			case 'confirm': {
				await this.handleConfirmCommand(payload.title, commandContent);
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
				await this.handleConfirmCommand(payload.title, payload.commandContent);
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

			// Get all files matching the source queries using the new function
			const filesByOperation = await this.plugin.obsidianAPITools.getFilesByMoveQueryExtraction(queryExtraction);

			// Count total files to move
			let totalFilesToMove = 0;
			filesByOperation.forEach(files => {
				totalFilesToMove += files.length;
			});

			// If no files match, inform the user without asking for confirmation
			if (totalFilesToMove === 0) {
				await this.plugin.updateConversationNote(
					title,
					`I couldn't find any files matching your query. Please try a different search term.`,
					'Steward'
				);
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
				let message = 'I need to create the following folders before moving files:\n';
				missingFolders.forEach(folder => {
					message += `- \`${folder}\`\n`;
				});
				message += '\nWould you like me to create these folders?';

				// Request confirmation with event to trigger after confirmation
				// Include filesByOperation in the context to avoid redundant queries
				await this.plugin.confirmationManager.requestConfirmation(
					title,
					'move-folders',
					message,
					{ missingFolders, queryExtraction, filesByOperation },
					{
						eventType: Events.MOVE_QUERY_EXTRACTED,
						payload: {
							title,
							queryExtraction,
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
			const result = await this.plugin.obsidianAPITools.moveByQueryExtraction(queryExtraction, filesByOperation);

			// Format the results using the existing helper method
			const response = this.formatMoveResult({
				operations: result.operations,
				lang: queryExtraction.lang || 'en',
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
			// Use the AI-enhanced search
			const { results, queryExtraction } = await this.plugin.obsidianAPITools.enhancedSearch(
				commandContent,
				10
			);

			// Get translation function for the specified language
			const t = getTranslation(queryExtraction.lang || 'en');

			// Format the results
			let response = `${queryExtraction.explanation} and used the query: "${queryExtraction.searchQuery}"\n\n`;

			// Add the search results count text
			if (results.length > 0) {
				response += `${t('search.found', { count: results.length })}`;

				results.forEach((result, index) => {
					response += `\n\n**${index + 1}- [[${result.fileName}]]:**\n`;

					if (result.matches.length > 0) {
						response += `\n${t('search.matches')}\n`;
						result.matches.slice(0, 3).forEach(match => {
							response += `\n> ${match.text.trim()}\n`;
						});

						if (result.matches.length > 3) {
							response += `\n_${t('search.moreMatches', { count: result.matches.length - 3 })}_`;
						}
					}
				});

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
			eventEmitter.emit(Events.CONVERSATION_NOTE_UPDATED, {
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
	 */
	private async handleConfirmCommand(title: string, commandContent: string): Promise<void> {
		// First check if the message is a clear confirmation response
		const response = this.plugin.confirmationManager.isConfirmationResponse(commandContent);

		// Find confirmations for this conversation
		const confirmationsForConversation =
			this.plugin.confirmationManager.getPendingConfirmationsForConversation(title);

		if (confirmationsForConversation.length === 0) {
			// No pending confirmations for this conversation
			await this.plugin.updateConversationNote(
				title,
				'There are no pending confirmations to respond to.',
				'Steward'
			);
			return;
		}

		// Get the oldest confirmation for this conversation
		const confirmation = confirmationsForConversation.sort((a, b) => a.createdAt - b.createdAt)[0];

		if (response) {
			// If it's a clear confirmation response, emit the event
			eventEmitter.emit(Events.CONFIRMATION_RESPONDED, {
				id: confirmation.id,
				confirmed: response.isAffirmative,
				conversationTitle: title,
			});
		} else {
			// If it's not a clear confirmation, let the user know
			await this.plugin.updateConversationNote(
				title,
				`I didn't understand your response. Please respond with 'yes' or 'no'.`,
				'Steward'
			);
		}
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
		const { operations, lang = 'en' } = result;

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
