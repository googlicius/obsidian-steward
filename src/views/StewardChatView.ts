import { MarkdownView, setIcon, setTooltip } from 'obsidian';
import { STW_CHAT_VIEW_CONFIG } from '../constants';
import { logger } from 'src/utils/logger';
import i18next from 'i18next';
import type { WorkspaceLeaf } from 'obsidian';
import type StewardPlugin from 'src/main';

export class StewardChatView extends MarkdownView {
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: StewardPlugin
  ) {
    super(leaf);

    // Mark this view as non-navigable
    this.navigation = false;
  }

  getViewType(): string {
    return STW_CHAT_VIEW_CONFIG.type;
  }

  getDisplayText(): string {
    return i18next.t('chat.stewardChat');
  }

  getIcon(): string {
    return STW_CHAT_VIEW_CONFIG.icon;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();

    this.containerEl.classList.add('stw-chat');

    this.createHeader();
    this.disableTitleEditing();
  }

  async onClose(): Promise<void> {
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
   * Disables editing of the title element by setting contenteditable to false
   */
  private disableTitleEditing(): void {
    const titleEl = this.containerEl.querySelector('.inline-title');
    if (titleEl instanceof HTMLElement) {
      titleEl.contentEditable = 'false';
    }
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
      setTooltip(newChatBtn, i18next.t('chat.newChat'));
      newChatBtn.addEventListener('click', () => this.handleNewChat());

      // History button
      // const historyBtn = headerEl.createEl('button', {
      //   cls: 'steward-header-button clickable-icon',
      // });
      // setIcon(historyBtn, 'history');
      // historyBtn.title = i18next.t('chat.history');
      // historyBtn.addEventListener('click', () => this.handleHistory());

      // Close Chat button
      const closeBtn = headerEl.createEl('button', {
        cls: 'steward-header-button clickable-icon',
      });
      setIcon(closeBtn, 'x');
      setTooltip(closeBtn, i18next.t('chat.closeChat'));
      closeBtn.addEventListener('click', () => {
        const rightSplit = this.app.workspace.rightSplit;
        rightSplit.collapse();
      });
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
      const lastLineNum = this.editor.lineCount() - 1;
      this.editor.setCursor({
        line: lastLineNum,
        ch: this.editor.getLine(lastLineNum).length,
      });
    });
  }

  /**
   * Open an existing conversation in the chat by replacing current content with an embed
   */
  public async openExistingConversation(
    conversationPath: string,
    options: { showInput?: boolean } = {}
  ): Promise<void> {
    if (!this.file) {
      logger.warn('Conversation file not found');
      return;
    }

    try {
      // Create the embed syntax
      let embedContent = `\n![[${conversationPath}]]\n\n`;

      if (options.showInput) {
        embedContent += '/ ';
      }

      // Replace the entire file content with the embed
      await this.app.vault.modify(this.file, embedContent);

      // Set the leaf as active and focus it
      this.app.workspace.setActiveLeaf(this.leaf, { focus: true });

      // Set the cursor to the last line
      const lastLineNum = this.editor.lineCount() - 1;
      this.editor.setCursor({
        line: lastLineNum,
        ch: this.editor.getLine(lastLineNum).length,
      });
    } catch (error) {
      logger.error('Error opening conversation in chat:', error);
    }
  }

  private getCurrentConversationPath(): string | null {
    const content = this.editor.getValue();

    const conversationPath = content.match(/!\[\[(.*?)\]\]/);
    if (conversationPath) {
      return conversationPath[1];
    }

    return null;
  }

  /**
   * Check if the chat view is visible and the current conversation path matches the given path
   * If no path is provided, return true if the chat view is visible
   */
  public isVisible(path?: string): boolean {
    let isVisible = this.containerEl.isShown();

    if (path) {
      const currentConversationPath = this.getCurrentConversationPath();
      if (currentConversationPath !== path) {
        isVisible = false;
      }
    }

    return isVisible;
  }
}
