import {
	Events,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationCommandReceivedPayload,
	CommandIntentExtractedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import StewardPlugin from '../main';
import { ConversationRenderer } from './ConversationRenderer';
import { logger } from 'src/utils/logger';

interface Props {
	plugin: StewardPlugin;
}

export class ConversationEventHandler {
	private readonly plugin: StewardPlugin;
	private readonly renderer: ConversationRenderer;

	constructor(props: Props) {
		this.plugin = props.plugin;
		this.renderer = this.plugin.conversationRenderer;
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

		// Listen for command intent extracted
		eventEmitter.on(Events.COMMAND_INTENT_EXTRACTED, (payload: CommandIntentExtractedPayload) => {
			this.handleCommandIntentExtracted(payload);
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
		await this.plugin.commandProcessorService.processCommands(payload);
	}

	private async handleConversationLinkInserted(
		payload: ConversationLinkInsertedPayload
	): Promise<void> {
		await this.plugin.commandProcessorService.processCommands(
			{
				title: payload.title,
				commands: [
					{
						commandType: payload.commandType,
						content: payload.commandContent,
					},
				],
				lang: payload.lang,
			},
			{ skipIndicators: true }
		);
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
}
