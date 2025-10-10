import { AbstractInputSuggest, type App, type TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const folders = this.app.vault.getAllFolders();

    if (!query) {
      return folders;
    }

    const lowerQuery = query.toLowerCase();
    return folders.filter(folder => folder.path.toLowerCase().includes(lowerQuery));
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
