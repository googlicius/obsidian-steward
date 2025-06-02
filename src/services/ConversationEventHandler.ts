import {
	Events,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationCommandReceivedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import StewardPlugin from '../main';
import { ConversationRenderer } from './ConversationRenderer';

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
	}

	private async handleNewConversation(payload: ConversationNoteCreatedPayload): Promise<void> {
		this.plugin.insertConversationLink(
			payload.view,
			payload.line,
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
}
