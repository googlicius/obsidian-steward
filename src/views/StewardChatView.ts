import { MarkdownView, setIcon, setTooltip, EventRef, TFile } from 'obsidian';
import { STW_CHAT_VIEW_CONFIG } from '../constants';
import { logger } from 'src/utils/logger';
import i18next from 'i18next';
import type { WorkspaceLeaf } from 'obsidian';
import type StewardPlugin from 'src/main';

export class StewardChatView extends MarkdownView {
  private autoScrollEventRef: EventRef | null = null;
  private scrollToBottomTimeout: NodeJS.Timeout | null = null;

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
    this.setupAutoScroll();
  }

  async onClose(): Promise<void> {
    this.cleanupAutoScroll();
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
   * Set up auto-scroll listener for streaming content
   */
  private setupAutoScroll(): void {
    // Clean up any existing listener
    this.cleanupAutoScroll();

    this.autoScrollEventRef = this.app.vault.on('modify', file => {
      if (!(file instanceof TFile)) {
        return;
      }

      // Only handle modifications if the view is visible
      if (!this.containerEl.isShown()) {
        return;
      }

      // Get the current conversation note path (the embedded wikilink)
      const notePath = this.getCurrentConversationPath();
      if (!notePath) {
        return;
      }

      // Only auto-scroll if this is the conversation note being modified
      if (file.path !== notePath) {
        return;
      }

      // Only auto-scroll during streaming
      if (!this.plugin.conversationRenderer.isStreaming(file.path)) {
        return;
      }

      // Schedule scroll with debouncing
      this.scheduleScrollToBottom();
    });
  }

  /**
   * Schedule a scroll to bottom operation with debouncing
   */
  private scheduleScrollToBottom(): void {
    // Clear existing timeout
    if (this.scrollToBottomTimeout) {
      clearTimeout(this.scrollToBottomTimeout);
    }

    // Schedule scroll with a small delay to batch rapid updates
    this.scrollToBottomTimeout = setTimeout(() => {
      this.scrollToBottom();
      this.scrollToBottomTimeout = null;
    }, 50);
  }

  /**
   * Scroll the editor to the bottom
   */
  private scrollToBottom(): void {
    if (!this.file || !this.containerEl.isShown()) {
      return;
    }

    try {
      const lastLineNum = this.editor.lineCount() - 1;
      if (lastLineNum >= 0) {
        const lastLine = this.editor.getLine(lastLineNum);
        const position = { line: lastLineNum, ch: lastLine.length };

        this.editor.scrollIntoView({ from: position, to: position }, true);
      }
    } catch (error) {
      logger.error('Error scrolling to bottom:', error);
    }
  }

  /**
   * Clean up auto-scroll resources
   */
  private cleanupAutoScroll(): void {
    if (this.autoScrollEventRef) {
      this.app.vault.offref(this.autoScrollEventRef);
      this.autoScrollEventRef = null;
    }

    if (this.scrollToBottomTimeout) {
      clearTimeout(this.scrollToBottomTimeout);
      this.scrollToBottomTimeout = null;
    }
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
    // Create header element and insert it as the first child of stw-chat (containerEl)
    const headerEl = document.createElement('div');
    headerEl.className = 'steward-conversation-header';

    // Make sure it's the first child of the container
    if (this.containerEl.firstChild) {
      this.containerEl.insertBefore(headerEl, this.containerEl.firstChild);
    } else {
      this.containerEl.appendChild(headerEl);
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

  private handleNewChat(): void {
    const initialContent = `\n/ `;

    if (!this.file) {
      logger.warn('Conversation file not found');
      return;
    }

    // Update the file with the new content immediately (non-blocking)
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

    // Check for new version asynchronously (non-blocking)
    this.checkAndDisplayVersionNotification();
  }

  /**
   * Checks for new version and displays notification using ConversationRenderer.updateConversationNote
   * This runs asynchronously without blocking the UI
   */
  private async checkAndDisplayVersionNotification(): Promise<void> {
    if (!this.file) {
      return;
    }

    try {
      // Check for new version (async call to GitHub API)
      const currentVersion = this.plugin.manifest.version;
      const newVersion = await this.plugin.versionCheckerService.checkForNewVersion(
        currentVersion,
        this.plugin.settings.lastSeenVersion
      );

      // If there's a new version, create/update the "New version" note and embed it in the chat
      if (newVersion) {
        const { version, body } = newVersion;

        // Create/update the release note in "Release notes" folder
        const releaseNotesFolder = `${this.plugin.settings.stewardFolder}/Release notes`;
        const releaseNoteTitle = `v${version}`;
        const releaseNotePath = `${releaseNotesFolder}/${releaseNoteTitle}.md`;

        // Create or update the release note file
        let releaseNoteFile = this.plugin.app.vault.getFileByPath(releaseNotePath);
        if (!releaseNoteFile) {
          releaseNoteFile = await this.plugin.app.vault.create(releaseNotePath, body || '');
        } else {
          await this.plugin.app.vault.modify(releaseNoteFile, body || '');
        }

        // Create notification message with link to release note
        const releaseNoteLink = `[[Release notes/${releaseNoteTitle}|Release notes]]`;
        const versionMessage = `${i18next.t('chat.newVersionMessage', { version })}\n\n${releaseNoteLink}`;

        // Format the message as a callout (like UpdateCommandHandler does)
        const formattedCallout = this.plugin.noteContentService.formatCallout(
          versionMessage,
          'info'
        );

        // Create/update the "New version" note directly in stewardFolder
        const versionNoteTitle = 'New version';
        const versionNotePath = `${this.plugin.settings.stewardFolder}/${versionNoteTitle}.md`;
        let versionNoteFile = this.plugin.app.vault.getFileByPath(versionNotePath);

        // Create the note if it doesn't exist
        if (!versionNoteFile) {
          // Create the note with the formatted callout
          versionNoteFile = await this.plugin.app.vault.create(versionNotePath, formattedCallout);
        } else {
          // Update the note by replacing all content
          await this.plugin.app.vault.modify(versionNoteFile, formattedCallout);
        }

        // Embed the version note in the chat file
        await this.app.vault.process(this.file, currentContent => {
          // Remove any existing "New version" embed to avoid duplicates
          const versionEmbedPattern = /!\[\[New version\]\]\n?/g;
          const cleanedContent = currentContent.replace(versionEmbedPattern, '');

          // Prepend the embed link
          return `![[New version]]\n${cleanedContent}`;
        });

        // Update last seen version
        this.plugin.settings.lastSeenVersion = version;
        await this.plugin.saveSettings();
      }
    } catch (error) {
      logger.error('Error checking for new version:', error);
      // Don't throw - this is a non-critical feature
    }
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

  /**
   * Get the current conversation note path from the embedded wikilink
   * Returns the full normalized file path (with .md extension) or null if not found
   */
  private getCurrentConversationPath(): string | null {
    const content = this.editor.getValue();

    const match = content.match(/!\[\[(.*?)\]\]/);
    if (!match) {
      return null;
    }

    const conversationPath = match[1];
    if (!conversationPath) {
      return null;
    }

    // Construct the full path to match against file paths
    // The conversationPath could be:
    // - Full path: "steward/Conversations/title"
    // - Just title: "title"
    let notePath: string;
    if (conversationPath.includes('/')) {
      // Already a full path
      notePath = conversationPath.endsWith('.md') ? conversationPath : `${conversationPath}.md`;
    } else {
      // Just the title, construct full path
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      notePath = `${folderPath}/${conversationPath}.md`;
    }

    return notePath;
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
