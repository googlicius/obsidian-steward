import { MarkdownView, setIcon, WorkspaceLeaf } from 'obsidian';
import { STW_CONVERSATION_VIEW_CONFIG } from '../constants';
import { logger } from 'src/utils/logger';
import i18next from 'i18next';

export class StewardConversationView extends MarkdownView {
	private markdownEmbedObserver: MutationObserver | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);

		// Mark this view as non-navigable
		this.navigation = false;
	}

	getViewType(): string {
		return STW_CONVERSATION_VIEW_CONFIG.type;
	}

	getDisplayText(): string {
		return 'Steward Chat';
	}

	getIcon(): string {
		return STW_CONVERSATION_VIEW_CONFIG.icon;
	}

	async onOpen(): Promise<void> {
		await super.onOpen();

		this.containerEl.classList.add('steward-conversation-wrapper');

		this.createHeader();
	}

	async onClose(): Promise<void> {
		// Disconnect the observer when view is closed
		if (this.markdownEmbedObserver) {
			this.markdownEmbedObserver.disconnect();
			this.markdownEmbedObserver = null;
		}

		return super.onClose();
	}

	/**
	 * Override canAcceptExtension to return false,
	 * which prevents this view from accepting new files
	 */
	canAcceptExtension(extension: string): boolean {
		return false;
	}

	/**
	 * Create the header with buttons
	 */
	private createHeader(): void {
		const viewContent = this.containerEl.querySelector('.view-content');

		// Create header element and insert it before the editor content
		if (viewContent) {
			const headerEl = document.createElement('div');
			headerEl.className = 'steward-conversation-header';

			// Make sure it's the first child of the view-content
			if (viewContent.firstChild) {
				viewContent.insertBefore(headerEl, viewContent.firstChild);
			} else {
				viewContent.appendChild(headerEl);
			}

			// New Chat button
			const newChatBtn = headerEl.createEl('button', {
				cls: 'steward-header-button clickable-icon',
			});
			setIcon(newChatBtn, 'plus-circle');
			newChatBtn.title = i18next.t('chat.newChat');
			newChatBtn.addEventListener('click', () => this.handleNewChat());

			// History button
			const historyBtn = headerEl.createEl('button', {
				cls: 'steward-header-button clickable-icon',
			});
			setIcon(historyBtn, 'history');
			historyBtn.title = i18next.t('chat.history');
			historyBtn.addEventListener('click', () => this.handleHistory());

			// Close Chat button
			const closeBtn = headerEl.createEl('button', {
				cls: 'steward-header-button clickable-icon',
			});
			setIcon(closeBtn, 'x');
			closeBtn.title = i18next.t('chat.closeChat');
			closeBtn.addEventListener('click', () => this.handleCloseChat());
		}
	}

	private handleNewChat(): void {
		const initialContent = `\n/ `;

		if (!this.file) {
			logger.warn('Conversation file not found');
			return;
		}

		// Update the file with the new content
		this.app.vault.modify(this.file, initialContent).then(() => {
			// Set the leaf as active and focus it
			this.app.workspace.setActiveLeaf(this.leaf, { focus: true });

			// Set the cursor to the last line
			this.editor.setCursor({
				line: this.editor.lineCount() - 1,
				ch: this.editor.getLine(this.editor.lineCount() - 1).length,
			});
		});
	}

	private handleHistory(): void {
		// TODO: Implement history functionality
		console.log('History button clicked');
	}

	private handleCloseChat(): void {
		this.toggleStaticConversation();
	}

	/**
	 * Toggles the static conversation sidebar open or closed
	 */
	private async toggleStaticConversation(): Promise<void> {
		// Find and click the right sidebar toggle button
		const toggleButton = document.querySelector('.sidebar-toggle-button.mod-right');
		if (toggleButton instanceof HTMLElement) {
			toggleButton.click();
		}
	}
}
