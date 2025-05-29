import { App, TFile } from 'obsidian';
import { SearchDatabase } from '../../database/SearchDatabase';
import { IndexedDocument, IndexedFolder, IndexedTerm } from '../../database/SearchDatabase';

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
			console.error('Error checking if index is built:', error);
			return false;
		}
	}
}
