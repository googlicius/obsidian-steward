import { AbstractInputSuggest, type App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const allFolders = this.app.vault.getAllFolders();
    const SLASH_PATTERN = '/';

    const slashesCount = query.match(new RegExp(SLASH_PATTERN, 'g'))?.length ?? 0;

    const matchedFolders = allFolders.filter(folder => {
      const level = folder.path.match(new RegExp(SLASH_PATTERN, 'g'))?.length ?? 0;
      return level === slashesCount && folder.path.toLowerCase().includes(query.toLowerCase());
    });

    if (matchedFolders.length === 1) {
      for (const child of matchedFolders[0].children) {
        if (child instanceof TFolder) {
          matchedFolders.push(child);
        }
      }
    }

    return matchedFolders;
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.createEl('div', { text: folder.path });
  }

  selectSuggestion(folder: TFolder): void {
    this.inputEl.value = folder.path;
    this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    this.inputEl.blur();
    this.close();
  }
}
