import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
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
        return true;
      })
      .sort((a, b) => {
        return b.stat.mtime - a.stat.mtime;
      })
      .slice(0, MAX_HISTORY_ITEMS);

    if (conversationFiles.length === 0) {
      return i18next.t('chat.noConversations');
    }

    const lines: string[] = [];
    for (const file of conversationFiles) {
      const displayText = this.buildHistoryDisplayText(file);
      const linkPath = file.path.replace(/\.md$/, '');
      lines.push(`- <a class="stw-history-link" data-path="${linkPath}">${displayText}</a>`);
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

  private buildHistoryDisplayText(file: TFile): string {
    const cache = this.app.metadataCache.getFileCache(file);
    const rawTitle = cache?.frontmatter?.conversation_title;
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      return file.basename;
    }

    // Wrap Obsidian tag-like tokens so they are rendered as plain text.
    return rawTitle.replace(/(^|\s)(#[\p{L}\p{N}_/-]+)/gu, '$1`$2`');
  }
}
