import { IndexedDocument, IndexedFolder } from 'src/database/SearchDatabase';
import { Condition, ConditionResult } from './Condition';

export class FolderCondition extends Condition<IndexedDocument> {
  constructor(private names: string[]) {
    super();
  }

  /**
   * Get folders by names
   */
  private async getFoldersByNames(names: string[]): Promise<IndexedFolder[]> {
    if (names.length === 0) return [];
    const matchedFolders: IndexedFolder[] = [];

    const allFolders = await this.context.documentStore.getAllFolders();
    allFolders.push(this.context.documentStore.getRootFolder());

    for (const name of names) {
      const matches = allFolders.filter(folder => {
        const nameReg = new RegExp(name, 'i');
        return nameReg.test(folder.name) || nameReg.test(folder.path);
      });

      // Only accept if exactly one match
      if (matches.length > 0) {
        matchedFolders.push(...matches);
      }
    }

    return matchedFolders;
  }

  async evaluate() {
    const result = new Map<number, ConditionResult<IndexedDocument>>();

    const folders = await this.getFoldersByNames(this.names);

    if (folders.length === 0) return result;

    const folderIdArray = folders.map(folder => folder.id as number);

    const termEntries = await this.context.documentStore.terms
      .where('folderId')
      .anyOf(folderIdArray)
      .toArray();
    const filteredEntries = termEntries.filter(item => folderIdArray.includes(item.folderId));

    // Remove duplicates
    const documentIds = new Set(filteredEntries.map(entry => entry.documentId));

    const documents = await this.context.documentStore.getDocumentsByIds([...documentIds]);

    for (const document of documents) {
      result.set(document.id as number, {
        document: document,
        score: 1,
      });
    }

    return result;
  }
}
