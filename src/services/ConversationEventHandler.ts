import {
	Events,
	ConversationNoteCreatedPayload,
	ConversationLinkInsertedPayload,
	ConversationCommandReceivedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import StewardPlugin from '../main';
import { ConversationRenderer } from './ConversationRenderer';
import { TFile } from 'obsidian';
import { createMockStreamResponse } from '../utils/textStreamer';
import { STEWARD_INTRODUCTION } from '../constants';
import i18next from 'i18next';

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
		this.plugin.registerEvent(
			// Listen for file modifications
			this.plugin.app.vault.on('modify', async file => {
				this.initializeChat(file as TFile);
				this.initializeIntroduction(file as TFile);
			})
		);

		this.plugin.registerEvent(
			// Listen for file creations
			this.plugin.app.vault.on('create', async file => {
				this.initializeChat(file as TFile, true);
				this.initializeIntroduction(file as TFile);
			})
		);

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

	unload(): void {
		//
	}

	private async initializeChat(file: TFile, newlyCreated = false): Promise<void> {
		if (file.name.startsWith('Steward Chat')) {
			const content = await this.plugin.app.vault.cachedRead(file);

			if (!content) {
				const streamContent = newlyCreated
					? `${i18next.t('ui.welcomeMessage')}\n\n[[${this.plugin.settings.stewardFolder}/Welcome to Steward|Introduction]]\n\n/ `
					: `${i18next.t('ui.welcomeMessage')}\n\n/ `;
				await this.renderer.streamFile(file, createMockStreamResponse(streamContent));

				this.plugin.setCursorToEndOfFile();
			}
		}
	}

	private async initializeIntroduction(file: TFile): Promise<void> {
		if (file.path === `${this.plugin.settings.stewardFolder}/Welcome to Steward.md`) {
			const content = await this.plugin.app.vault.cachedRead(file);
			if (!content.trim()) {
				this.renderer.streamFile(file, createMockStreamResponse(STEWARD_INTRODUCTION));
			}
		}
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
