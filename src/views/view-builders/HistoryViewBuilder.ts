import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { formatRelativeTime, parseFrontmatterDate } from 'src/utils/dateUtils';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { ViewBuilder } from './ViewBuilder';

const { i18next } = getBundledInternal('i18n');

const HISTORY_FILE_NAME = 'History.md';

export class HistoryViewBuilder implements ViewBuilder {
  constructor(
    private app: App,
    private plugin: StewardPlugin
  ) {}

  getFilePath(): string {
    return `${this.plugin.settings.stewardFolder}/${HISTORY_FILE_NAME}`;
  }

  async buildContent(): Promise<string> {
    const MAX_HISTORY_ITEMS = 50;
    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const folder = this.app.vault.getFolderByPath(folderPath);

    if (!folder) {
      return i18next.t('chat.noConversations');
    }

    const conversationFiles = folder.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === 'md')
      .filter(file => {
        const cache = this.app.metadataCache.getFileCache(file);
        // Exclude notes are from subagents and has host_conversation
        if (cache?.frontmatter?.parent || cache?.frontmatter?.host_conversation) {
          return false;
        }
        // Exclude shell output archive files
        if (file.basename.endsWith('__shell')) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        return this.getConversationTimestamp(b) - this.getConversationTimestamp(a);
      })
      .slice(0, MAX_HISTORY_ITEMS);

    if (conversationFiles.length === 0) {
      return i18next.t('chat.noConversations');
    }

    const lines: string[] = [];
    for (const file of conversationFiles) {
      const displayText = this.buildHistoryDisplayText(file);
      const createdAtMarkup = this.buildCreatedAtMarkup(file);
      const linkPath = file.path.replace(/\.md$/, '');
      lines.push(
        `- <a class="stw-history-link" data-path="${linkPath}">${displayText}</a>${createdAtMarkup}`
      );
    }

    return lines.join('\n');
  }

  async write(content: string): Promise<void> {
    const historyNotePath = this.getFilePath();
    const existingFile = this.app.vault.getFileByPath(historyNotePath);

    if (existingFile) {
      await this.app.vault.modify(existingFile, content);
      return;
    }

    await this.app.vault.create(historyNotePath, content);
  }

  private getConversationTimestamp(file: TFile): number {
    const cache = this.app.metadataCache.getFileCache(file);
    const createdAt = parseFrontmatterDate(cache?.frontmatter?.created_at);
    if (createdAt) {
      return createdAt.getTime();
    }

    return file.stat.mtime;
  }

  private buildHistoryDisplayText(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const rawTitle = cache?.frontmatter?.conversation_title;
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      return file.basename;
    }

    // Wrap Obsidian tag-like tokens so they are rendered as plain text.
    return rawTitle.replace(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu, '$1`$2`');
  }

  private buildCreatedAtMarkup(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const createdAt = parseFrontmatterDate(cache?.frontmatter?.created_at);
    if (!createdAt) {
      return '';
    }

    const locale = i18next.language || 'en';
    const relativeTime = formatRelativeTime(createdAt, locale);
    const absoluteTime = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(createdAt);

    return ` <span class="stw-history-created" title="${absoluteTime}">${relativeTime}</span>`;
  }
}
