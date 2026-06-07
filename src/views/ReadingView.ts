import type { ViewStateResult } from 'obsidian';
import { READING_VIEW_CONFIG } from '../constants';
import { StewardMarkdownView } from './StewardMarkdownView';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { WorkspaceLeaf } from 'obsidian';
import type StewardPlugin from 'src/main';

const { i18next } = getBundledInternal('i18n');

export class ReadingView extends StewardMarkdownView {
  private showPropertiesObserver: MutationObserver | undefined;

  constructor(leaf: WorkspaceLeaf, plugin: StewardPlugin) {
    super(leaf, plugin);
  }

  getViewType(): string {
    return READING_VIEW_CONFIG.type;
  }

  getDisplayText(): string {
    if (this.file) {
      return this.file.basename;
    }
    return i18next.t('chat.history');
  }

  getIcon(): string {
    return READING_VIEW_CONFIG.icon;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();

    this.containerEl.classList.add('stw-reading');
    this.ensurePropertiesHidden();

    if (this.getMode() !== 'preview') {
      await this.setState({ ...this.getState(), mode: 'preview' }, { history: false });
    }
  }

  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    await super.setState({ ...state, mode: 'preview' }, result);
    this.stripShowProperties();
  }

  private ensurePropertiesHidden(): void {
    this.stripShowProperties();

    if (this.showPropertiesObserver) {
      return;
    }

    this.showPropertiesObserver = new MutationObserver(() => {
      this.stripShowProperties();
    });
    this.showPropertiesObserver.observe(this.containerEl, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    this.register(() => {
      this.showPropertiesObserver?.disconnect();
      this.showPropertiesObserver = undefined;
    });
  }

  private stripShowProperties(): void {
    const elements = this.containerEl.querySelectorAll('.show-properties');
    for (let i = 0; i < elements.length; i++) {
      elements[i].classList.remove('show-properties');
    }
  }
}
