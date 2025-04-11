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
				console.log('search', payload);
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
			await this.plugin.updateConversationNote(title, answer);
		} catch (error) {
			await this.plugin.updateConversationNote(title, error.message);
		}
	}

	private async handleMoveCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Parse the command to extract source and destination
			const { source, destination } = this.parseMoveCommand(commandContent);

			if (!source || !destination) {
				throw new Error(
					"Could not determine source and destination from the command. Please use format: 'move [files with tag #tag] to [destination]'"
				);
			}

			// Perform the move operation
			let result;
			if (source.startsWith('#')) {
				// Move by tag
				result = await this.plugin.obsidianAPITools.moveFilesByTags([source], destination);
			} else {
				// Move by search
				result = await this.plugin.obsidianAPITools.moveFilesBySearch(source, destination);
			}

			// Format the result for the conversation
			const response = this.formatMoveResult(result);
			await this.plugin.updateConversationNote(title, response);
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`);
		}
	}

	private async handleSearchCommand(title: string, commandContent: string): Promise<void> {
		try {
			// Perform the search
			const results = await this.plugin.obsidianAPITools.search(commandContent, 10);

			// Format the results
			let response = `I searched your vault for "${commandContent}" and found ${results.length} results:`;

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

			await this.plugin.updateConversationNote(title, response);
		} catch (error) {
			await this.plugin.updateConversationNote(title, `Error: ${error.message}`);
		}
	}

	// Helper to parse the move command
	private parseMoveCommand(command: string): { source: string; destination: string } {
		// Example patterns:
		// "move files with tag #project to Archive/2023"
		// "move notes containing project plan to Projects/2023"

		let source = '';
		let destination = '';

		if (command.includes(' to ')) {
			const parts = command.split(' to ');
			destination = parts.pop()?.trim() || '';
			const sourcePart = parts.join(' to ');

			if (sourcePart.includes('tag ')) {
				source = sourcePart.split('tag ').pop()?.trim() || '';
			} else if (sourcePart.includes('containing ')) {
				source = sourcePart.split('containing ').pop()?.trim() || '';
			} else {
				source = sourcePart;
			}
		}

		return { source, destination };
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
