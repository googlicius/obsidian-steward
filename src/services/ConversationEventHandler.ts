import {
  Events,
  ConversationLinkInsertedPayload,
  ConversationCommandReceivedPayload,
} from '../types/events';
import { eventEmitter } from './EventEmitter';
import { TFile } from 'obsidian';
import { createMockStreamResponse } from '../utils/textStreamer';
import i18next from 'i18next';
import type StewardPlugin from '../main';
import type { ConversationRenderer } from './ConversationRenderer';

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
        if (file instanceof TFile) {
          this.initializeChat(file);
          // this.initializeIntroduction(file);
        }
      })
    );

    this.plugin.registerEvent(
      // Listen for file creations
      this.plugin.app.vault.on('create', async file => {
        if (file instanceof TFile) {
          this.initializeChat(file);
          // this.initializeIntroduction(file);
        }
      })
    );

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

  private async initializeChat(file: TFile): Promise<void> {
    if (!file.name.startsWith('Steward Chat')) {
      return;
    }

    const content = await this.plugin.app.vault.cachedRead(file);

    if (content) {
      return;
    }

    const streamContent = `${i18next.t('ui.welcomeMessage')}\n\n/ `;
    await this.renderer.streamFile(file, createMockStreamResponse(streamContent));

    this.plugin.setCursorToEndOfFile();
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
            query: payload.commandQuery,
          },
        ],
        lang: payload.lang,
      },
      {
        skipIndicators: true,
        sendToDownstream: {
          isReloadRequest: false,
        },
      }
    );
  }
}
