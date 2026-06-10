import { EventRef, TFile } from 'obsidian';
import { CHAT_VIEW_CONFIG } from '../constants';
import { StewardMarkdownView } from './StewardMarkdownView';
import { logger } from 'src/utils/logger';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { WorkspaceLeaf } from 'obsidian';
import type StewardPlugin from 'src/main';

const { i18next } = getBundledInternal('i18n');

export class ChatView extends StewardMarkdownView {
  private autoScrollEventRef: EventRef | null = null;
  private scrollToBottomTimeout: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: StewardPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return CHAT_VIEW_CONFIG.type;
  }

  getDisplayText(): string {
    return i18next.t('chat.stewardChat');
  }

  getIcon(): string {
    return CHAT_VIEW_CONFIG.icon;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();

    this.containerEl.classList.add('stw-chat');
    this.setupAutoScroll();
  }

  async onClose(): Promise<void> {
    this.cleanupAutoScroll();
    return super.onClose();
  }

  /**
   * Set up auto-scroll listener for streaming content
   */
  private setupAutoScroll(): void {
    this.cleanupAutoScroll();

    this.autoScrollEventRef = this.app.vault.on('modify', file => {
      if (!(file instanceof TFile)) {
        return;
      }

      if (!this.containerEl.isShown()) {
        return;
      }

      const notePath = this.getCurrentConversationPath();
      if (!notePath) {
        return;
      }

      if (file.path !== notePath) {
        return;
      }

      if (!this.plugin.conversationRenderer.isStreaming(file.path)) {
        return;
      }

      if (!this.plugin.settings.autoScroll) {
        return;
      }

      this.scheduleScrollToBottom();
    });
  }

  private scheduleScrollToBottom(): void {
    if (this.scrollToBottomTimeout) {
      window.clearTimeout(this.scrollToBottomTimeout);
    }

    this.scrollToBottomTimeout = window.setTimeout(() => {
      this.scrollToBottom();
      this.scrollToBottomTimeout = null;
    }, 50);
  }

  private scrollToBottom(): void {
    if (!this.file || !this.containerEl.isShown()) {
      return;
    }

    try {
      const lastLineNum = this.editor.lineCount() - 1;
      if (lastLineNum >= 0) {
        const lastLine = this.editor.getLine(lastLineNum);
        const position = { line: lastLineNum, ch: lastLine.length };

        this.editor.scrollIntoView({ from: position, to: position });
      }
    } catch (error) {
      logger.error('Error scrolling to bottom:', error);
    }
  }

  private cleanupAutoScroll(): void {
    if (this.autoScrollEventRef) {
      this.app.vault.offref(this.autoScrollEventRef);
      this.autoScrollEventRef = null;
    }

    if (this.scrollToBottomTimeout) {
      window.clearTimeout(this.scrollToBottomTimeout);
      this.scrollToBottomTimeout = null;
    }
  }

  public startNewChat(): void {
    const initialContent = '\n/ ';

    if (!this.file) {
      logger.warn('Conversation file not found');
      return;
    }

    void this.app.vault.modify(this.file, initialContent).then(() => {
      this.app.workspace.setActiveLeaf(this.leaf, { focus: true });

      const lastLineNum = this.editor.lineCount() - 1;
      this.editor.setCursor({
        line: lastLineNum,
        ch: this.editor.getLine(lastLineNum).length,
      });
    });

    void this.checkAndDisplayVersionNotification();
  }

  private async checkAndDisplayVersionNotification(): Promise<void> {
    if (!this.file) {
      return;
    }

    try {
      const currentVersion = this.plugin.manifest.version;
      const newVersion = await this.plugin.versionCheckerService.checkForNewVersion(
        currentVersion,
        this.plugin.settings.lastSeenVersion
      );

      if (newVersion) {
        const { version, body } = newVersion;

        const releaseNotesFolder = `${this.plugin.settings.stewardFolder}/Release notes`;
        const releaseNoteTitle = `v${version}`;
        const releaseNotePath = `${releaseNotesFolder}/${releaseNoteTitle}.md`;

        let releaseNoteFile = this.plugin.app.vault.getFileByPath(releaseNotePath);
        if (!releaseNoteFile) {
          releaseNoteFile = await this.plugin.app.vault.create(releaseNotePath, body || '');
        } else {
          await this.plugin.app.vault.modify(releaseNoteFile, body || '');
        }

        const releaseNoteLink = `[[Release notes/${releaseNoteTitle}|Release notes]]`;
        const dismiss = i18next.t('common.dismiss');
        const dismissButton = `<button type="button" class="stw-callout-action" data-action="dismiss-version-notify">${dismiss}</button>`;
        const versionMessage = `${i18next.t('chat.newVersionMessage', { version })}\n\n${releaseNoteLink}\n\n${dismissButton}`;

        const formattedCallout = this.plugin.noteContentService.formatCallout(
          versionMessage,
          'stw-notify'
        );

        const versionNotePath = `${this.plugin.settings.stewardFolder}/New version.md`;
        let versionNoteFile = this.plugin.app.vault.getFileByPath(versionNotePath);

        if (!versionNoteFile) {
          versionNoteFile = await this.plugin.app.vault.create(versionNotePath, formattedCallout);
        } else {
          await this.plugin.app.vault.modify(versionNoteFile, formattedCallout);
        }

        await this.app.vault.process(this.file, currentContent => {
          const cleanedContent = this.plugin.noteContentService.removeEmbedLink(
            currentContent,
            'New version'
          );

          return `![[New version]]\n${cleanedContent}`;
        });

        this.plugin.settings.lastSeenVersion = version;
        await this.plugin.saveSettings();
      }
    } catch (error) {
      logger.error('Error checking for new version:', error);
    }
  }

  /**
   * Open an existing conversation in the chat by replacing current content with an embed.
   */
  public async openExistingConversation(conversationPath: string): Promise<void> {
    if (!this.file) {
      logger.warn('Conversation file not found');
      return;
    }

    try {
      const forwardService = this.plugin.wikilinkForwardService;
      const originalTitle = conversationPath.split('/').pop()?.replace(/\.md$/, '') ?? '';
      const resolvedTitle = forwardService.resolveForwardedChainTerminalTitle(originalTitle);

      const embedPath =
        resolvedTitle && resolvedTitle !== originalTitle
          ? forwardService.getConversationEmbedPath(resolvedTitle)
          : conversationPath;

      let embedContent = `\n![[${embedPath}]]\n\n`;
      if (resolvedTitle && forwardService.shouldAppendInputLineForConversation(resolvedTitle)) {
        embedContent += '/ ';
      }

      await this.app.vault.modify(this.file, embedContent);

      this.app.workspace.setActiveLeaf(this.leaf, { focus: true });

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

    const match = content.match(/!\[\[(.*?)\]\]/);
    if (!match) {
      return null;
    }

    const conversationPath = match[1];
    if (!conversationPath) {
      return null;
    }

    let notePath: string;
    if (conversationPath.includes('/')) {
      notePath = conversationPath.endsWith('.md') ? conversationPath : `${conversationPath}.md`;
    } else {
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      notePath = `${folderPath}/${conversationPath}.md`;
    }

    return notePath;
  }

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
