import {
	Events,
	ErrorEvents,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationNoteUpdatedPayload,
	MoveQueryExtractedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import * as mathTools from 'src/tools/mathTools';
import StewardPlugin, { GeneratorText } from 'src/main';

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
			payload.commandContent
		);
	}

	private async handleConversationNoteUpdated(
		payload: ConversationNoteUpdatedPayload
	): Promise<void> {
		switch (payload.commandType) {
			case 'calc': {
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.Calculating);
				await this.handleMathCalculation(payload.title, payload.commandContent);
				break;
			}

			case 'move': {
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.ExtractingMoveQuery);
				await this.handleMoveCommand(payload.title, payload.commandContent);
				break;
			}

			case 'search': {
				await this.plugin.addGeneratingIndicator(payload.title, GeneratorText.Searching);
				await this.handleSearchCommand(payload.title, payload.commandContent);
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
			// Extract the move query using AI
			const queryExtraction = await this.plugin.obsidianAPITools.extractMoveQuery(commandContent);

			// Update the conversation note with the extraction explanation
			const initialResponse = `${queryExtraction.explanation}\n\n*${GeneratorText.Moving}*`;
			await this.plugin.updateConversationNote(title, initialResponse, 'Steward');

			// Emit event to trigger the actual move operation
			eventEmitter.emit(Events.MOVE_QUERY_EXTRACTED, {
				title,
				queryExtraction,
			});
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`, 'Steward');
		}
	}

	/**
	 * Handles the move query extracted event
	 * @param payload The event payload containing the query extraction
	 */
	private async handleMoveQueryExtracted(payload: MoveQueryExtractedPayload): Promise<void> {
		const { title, queryExtraction } = payload;
		try {
			// Use the moveByQueryExtraction method to perform the actual move
			const result = await this.plugin.obsidianAPITools.moveByQueryExtraction(queryExtraction);

			// Format the results using the existing helper method
			const response = this.formatMoveResult(result);

			// Update the conversation note with the results
			await this.plugin.updateConversationNote(title, response);
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error while moving files: ${error.message}`);
		}
	}

	private async handleSearchCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Use the AI-enhanced search
			const { results, queryExtraction } = await this.plugin.obsidianAPITools.enhancedSearch(
				commandContent,
				10
			);

			// Format the results
			let response = `${queryExtraction.explanation} and used the query: "${queryExtraction.searchQuery}"\n\nI found ${results.length} results:`;

			if (results.length > 0) {
				results.forEach((result, index) => {
					response += `\n\n**${index + 1}- [[${result.fileName}]]:**\n`;

					if (result.matches.length > 0) {
						response += '\nMatches:\n';
						result.matches.slice(0, 3).forEach(match => {
							response += `\n> ${match.text.trim()}\n`;
						});

						if (result.matches.length > 3) {
							response += `\n_... and ${result.matches.length - 3} more matches_`;
						}
					}
				});

				response += '\n\nWould you like me to show more details for any specific result?';
			} else {
				response += '\n\nNo results found. Would you like to try a different search term?';
			}

			await this.plugin.updateConversationNote(title, response, 'Steward');
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`, 'Steward');
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
		moved: string[];
		errors: string[];
		skipped: string[];
	}): string {
		const { moved, errors, skipped } = result;
		const totalCount = moved.length + errors.length + skipped.length;

		let response = `I found ${totalCount} file${totalCount !== 1 ? 's' : ''} matching your query.`;

		if (moved.length > 0) {
			response += `\n\n**Successfully moved ${moved.length} file${moved.length !== 1 ? 's' : ''}:**`;
			moved.forEach(file => {
				response += `\n- [[${file}]]`;
			});
		}

		if (skipped.length > 0) {
			response += `\n\n**Skipped ${skipped.length} file${skipped.length !== 1 ? 's' : ''} (already in destination):**`;
			skipped.forEach(file => {
				response += `\n- [[${file}]]`;
			});
		}

		if (errors.length > 0) {
			response += `\n\n**Failed to move ${errors.length} file${errors.length !== 1 ? 's' : ''}:**`;
			errors.forEach(file => {
				response += `\n- [[${file}]]`;
			});
		}

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
