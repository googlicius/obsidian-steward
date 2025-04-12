import {
	Events,
	ErrorEvents,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationNoteUpdatedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import * as mathTools from 'src/tools/mathTools';
import StewardPlugin from 'src/main';

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
				await this.plugin.addGeneratingIndicator(payload.title);
				await this.handleMathCalculation(payload.title, payload.commandContent);
				break;
			}

			case 'move': {
				await this.plugin.addGeneratingIndicator(payload.title);
				await this.handleMoveCommand(payload.title, payload.commandContent);
				break;
			}

			case 'search': {
				await this.plugin.addGeneratingIndicator(payload.title);
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
			// Use the AI-enhanced move
			const { result, queryExtraction } =
				await this.plugin.obsidianAPITools.enhancedMove(commandContent);

			// Format the results using the existing helper method
			const response = `${queryExtraction.explanation}\n\n${this.formatMoveResult(result)}`;

			await this.plugin.updateConversationNote(title, response, 'Steward');
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`, 'Steward');
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
	private formatMoveResult(result: { moved: string[]; errors: string[] }): string {
		const { moved, errors } = result;

		let response = `I've moved ${moved.length} file${moved.length !== 1 ? 's' : ''} successfully.`;

		if (moved.length > 0) {
			response += '\n\n**Moved files:**';
			moved.forEach(file => {
				response += `\n- ${file}`;
			});
		}

		if (errors.length > 0) {
			response += '\n\n**Failed to move:**';
			errors.forEach(file => {
				response += `\n- ${file}`;
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
