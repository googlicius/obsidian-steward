import type { App, TFile } from 'obsidian';
import {
  SearchDatabase,
  IndexedDocument,
  IndexedFolder,
  IndexedTerm,
  IndexedProperty,
} from '../../database/SearchDatabase';
import { logger } from '../../utils/logger';

export interface DocumentStoreConfig {
  app: App;
  dbName: string;
  excludeFolders: string[];
}

export class DocumentStore {
  private db: SearchDatabase;
  private app: App;
  private excludeFolders: string[];

  constructor({ app, dbName, excludeFolders }: DocumentStoreConfig) {
    this.app = app;
    this.db = new SearchDatabase(dbName);
    this.excludeFolders = excludeFolders || [];
  }

  get terms() {
    return this.db.terms;
  }

  get documents() {
    return this.db.documents;
  }

  get folders() {
    return this.db.folders;
  }

  get properties() {
    return this.db.properties;
  }

  /**
   * Update exclude folders
   */
  public updateExcludeFolders(excludeFolders: string[]): void {
    this.excludeFolders = excludeFolders;
  }

  /**
   * Get all markdown files from the vault
   */
  public async getAllMarkdownFiles(): Promise<TFile[]> {
    return this.app.vault.getMarkdownFiles();
  }

  /**
   * Get all files from the vault
   */
  public async getAllFiles(): Promise<TFile[]> {
    // Get all files from the vault
    const allFiles = this.app.vault.getFiles();
    return allFiles;
  }

  /**
   * Read file content
   */
  public async readFile(file: TFile): Promise<string> {
    return this.app.vault.read(file);
  }

  /**
   * Get file metadata cache
   */
  public getFileCache(file: TFile) {
    return this.app.metadataCache.getFileCache(file);
  }

  /**
   * Check if file should be excluded from indexing
   */
  public isExcluded(filePath: string): boolean {
    return this.excludeFolders.some(
      folder =>
        filePath.startsWith(this.app.vault.configDir + '/' + folder) || filePath.startsWith(folder)
    );
  }

  /**
   * Store a document in the database
   */
  public async storeDocument(document: IndexedDocument): Promise<number> {
    return this.db.documents.add(document);
  }

  /**
   * Update an existing document
   */
  public async updateDocument(id: number, document: Partial<IndexedDocument>): Promise<void> {
    await this.db.documents.update(id, document);
  }

  /**
   * Delete a document
   */
  public async deleteDocument(id: number): Promise<void> {
    await this.db.documents.delete(id);
  }

  /**
   * Store terms for a document
   */
  public async storeTerms(terms: IndexedTerm[]): Promise<void> {
    await this.db.terms.bulkAdd(terms);
  }

  /**
   * Delete terms for a document
   */
  public async deleteTerms(documentId: number): Promise<void> {
    await this.db.terms.where('documentId').equals(documentId).delete();
  }

  /**
   * Store a folder
   */
  public async storeFolder(folder: IndexedFolder): Promise<number> {
    return this.db.folders.add(folder);
  }

  /**
   * Get folder by path
   */
  public async getFolderByPath(path: string): Promise<IndexedFolder | undefined> {
    return this.db.folders.where('path').equals(path).first();
  }

  /**
   * Get document by path
   */
  public async getDocumentByPath(path: string): Promise<IndexedDocument | undefined> {
    return this.db.documents.where('path').equals(path).first();
  }

  /**
   * Get all folders
   */
  public async getAllFolders(): Promise<IndexedFolder[]> {
    return this.db.folders.toArray();
  }

  /**
   * Get root folder
   */
  public getRootFolder(): IndexedFolder {
    return {
      id: 0,
      path: '',
      name: '/',
    };
  }

  /**
   * Get total document count
   */
  public async getTotalDocumentCount(): Promise<number> {
    return this.db.documents.count();
  }

  /**
   * Get documents by IDs
   */
  public async getDocumentsByIds(ids: number[]): Promise<IndexedDocument[]> {
    return this.db.documents.where('id').anyOf(ids).toArray();
  }

  /**
   * Get terms by document ID
   */
  public async getTermsByDocumentId(documentId: number): Promise<IndexedTerm[]> {
    return this.db.terms.where('documentId').equals(documentId).toArray();
  }

  /**
   * Get terms by term value
   */
  public async getTermsByValue(terms: string[]): Promise<IndexedTerm[]> {
    return this.db.terms.where('term').anyOf(terms).toArray();
  }

  /**
   * Get document count in a folder
   */
  public async getDocumentCountInFolder(folderPath: string): Promise<number> {
    return this.db.documents
      .where('path')
      .startsWith(folderPath + '/')
      .count();
  }

  /**
   * Check if index is built
   */
  public async isIndexBuilt(): Promise<boolean> {
    try {
      const firstDoc = await this.db.documents.limit(1).first();
      return firstDoc !== undefined;
    } catch (error) {
      logger.error('Error checking if index is built:', error);
      return false;
    }
  }

  /**
   * Store a property for a document
   */
  public async storeProperty(property: IndexedProperty): Promise<number> {
    return this.db.properties.add(property);
  }

  /**
   * Store multiple properties for a document
   */
  public async storeProperties(properties: IndexedProperty[]): Promise<void> {
    if (properties.length === 0) return;
    await this.db.properties.bulkAdd(properties);
  }

  /**
   * Get properties for a document
   */
  public async getPropertiesByDocumentId(documentId: number): Promise<IndexedProperty[]> {
    return this.db.properties.where('documentId').equals(documentId).toArray();
  }

  /**
   * Get documents by property name and value
   */
  public async getDocumentsByProperty(name: string, value: unknown): Promise<IndexedDocument[]> {
    // Find property matches
    // For compound index queries, we need to use a more specific approach
    const properties = await this.db.properties
      .where('name')
      .equals(name.toLowerCase())
      .and(prop => prop.value === value)
      .toArray();

    if (properties.length === 0) return [];

    // Get unique document IDs
    const documentIds = [...new Set(properties.map(p => p.documentId))];

    // Return the documents
    return this.getDocumentsByIds(documentIds);
  }

  /**
   * Delete properties for a document
   */
  public async deletePropertiesByDocumentId(documentId: number): Promise<void> {
    await this.db.properties.where('documentId').equals(documentId).delete();
  }

  /**
   * Get all property names in the database
   */
  public async getAllPropertyNames(): Promise<string[]> {
    const names = await this.db.properties.orderBy('name').uniqueKeys();
    return names as string[];
  }
}
