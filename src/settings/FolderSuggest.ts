import { AbstractInputSuggest, type App, type TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const allFolders = this.app.vault.getAllFolders();

    // Filter to only level 1 folders (folders directly under root, no slashes in path)
    const level1Folders = allFolders.filter(folder => {
      // Level 1 folders have no "/" in their path (excluding root which is empty)
      return folder.path && !folder.path.includes('/');
    });

    if (!query) {
      return level1Folders;
    }

    const lowerQuery = query.toLowerCase();
    return level1Folders.filter(folder => folder.path.toLowerCase().includes(lowerQuery));
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
