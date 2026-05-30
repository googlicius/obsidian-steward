import { MarkdownView, setIcon, setTooltip } from 'obsidian';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { HistoryViewBuilder } from 'src/views/view-builders/HistoryViewBuilder';
import { refreshViewBuilder } from 'src/views/view-builders/ViewBuilder';
import type { WorkspaceLeaf } from 'obsidian';
import type StewardPlugin from 'src/main';

const { i18next } = getBundledInternal('i18n');

export abstract class StewardMarkdownView extends MarkdownView {
  private dockToggleBtn: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    protected plugin: StewardPlugin
  ) {
    super(leaf);
    this.navigation = false;
  }

  async onOpen(): Promise<void> {
    await super.onOpen();

    this.containerEl.classList.add('stw-view');
    this.setupSharedHeader();

    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.refreshDockToggleButton();
      })
    );
  }

  canAcceptExtension(_extension: string): boolean {
    return false;
  }

  /**
   * Replace the default view-header controls with shared steward actions.
   * CSS forces `.view-header` to stay visible in sidebar and mobile layouts.
   */
  protected setupSharedHeader(): void {
    const viewHeader = this.containerEl.querySelector('.view-header');
    if (!(viewHeader instanceof HTMLElement)) {
      return;
    }

    viewHeader.empty();
    const actionsEl = viewHeader.createDiv({ cls: 'view-actions' });

    this.createHeaderAction(actionsEl, 'plus-circle', i18next.t('chat.newChat'), () => {
      void this.plugin.startNewChat(this.leaf);
    });

    this.createHeaderAction(actionsEl, 'history', i18next.t('chat.history'), () => {
      void this.openHistoryInLeaf();
    });

    this.dockToggleBtn = this.createHeaderAction(
      actionsEl,
      'arrow-right',
      i18next.t('chat.moveChatToRight'),
      () => {
        void this.plugin.toggleViewDockFromView(this.leaf);
      }
    );
    this.refreshDockToggleButton();
  }

  private async openHistoryInLeaf(): Promise<void> {
    const builder = new HistoryViewBuilder(this.app, this.plugin);
    await refreshViewBuilder(builder);
    await this.plugin.openReadingView({ filePath: builder.getFilePath(), leaf: this.leaf });
  }

  protected createHeaderAction(
    parent: HTMLElement,
    icon: string,
    tooltip: string,
    onClick: () => void
  ): HTMLElement {
    const actionEl = parent.createEl('a', {
      cls: 'view-action clickable-icon',
      href: '#',
      attr: { 'aria-label': tooltip },
    });
    setIcon(actionEl, icon);
    setTooltip(actionEl, tooltip);
    actionEl.addEventListener('click', evt => {
      evt.preventDefault();
      onClick();
    });
    return actionEl;
  }

  protected refreshDockToggleButton(): void {
    if (!this.dockToggleBtn) {
      return;
    }
    const inRight = this.plugin.leafIsInRightSidebar(this.leaf);
    setIcon(this.dockToggleBtn, inRight ? 'arrow-left' : 'arrow-right');
    setTooltip(
      this.dockToggleBtn,
      i18next.t(inRight ? 'chat.moveChatToMain' : 'chat.moveChatToRight')
    );
  }
}
