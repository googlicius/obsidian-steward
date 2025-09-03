import { IndexedFolder } from 'src/database/SearchDatabase';
import { Condition, ConditionResult } from './Condition';

/**
 * Condition for filtering by folder (path or name).
 */
export class FolderCondition extends Condition {
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

  async evaluate(): Promise<Map<number, ConditionResult>> {
    const result = new Map<number, ConditionResult>();

    const folders = await this.getFoldersByNames(this.names);

    if (folders.length === 0) return result;

    // Find documents in those folders (filter by path prefix)
    const folderIdArray = folders.map(folder => folder.id as number);

    const termEntries = await this.context.documentStore.terms
      .where('folderId')
      .anyOf(folderIdArray)
      .toArray();
    const filteredEntries = termEntries.filter(item => folderIdArray.includes(item.folderId));

    // Convert to Set to remove duplicates
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
