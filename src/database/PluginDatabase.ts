import Dexie, { Table } from 'dexie';

/**
 * Document in the search index
 */
export interface IndexedDocument {
	id?: number; // Auto-incremented document ID
	path: string; // File path as unique ID
	fileName: string; // File name without extension (lowercase)
	lastModified: number; // Timestamp of last modification
	tags: string[]; // Tags extracted from content and frontmatter
	tokenCount?: number; // Total number of tokens in the document for TF-IDF scoring
}

/**
 * Source of a term in the index
 */
export enum TermSource {
	Content = 0,
	Filename = 1,
}

/**
 * Term in the inverted index
 */
export interface IndexedTerm {
	term: string; // The indexed term
	documentId: number; // ID of document containing the term
	folderId: number; // ID of folder containing the term
	source: TermSource; // Source of the term (content or filename)
	frequency: number; // Number of occurrences in the document
	positions: number[]; // Positions in the document
}

export interface IndexedFolder {
	id?: number; // Auto-incremented folder ID
	path: string; // Folder path (used as the primary key)
	name: string; // Last segment of the folder path
}

/**
 * Database class for the Obsidian Steward plugin
 */
export class PluginDatabase extends Dexie {
	documents!: Table<IndexedDocument>;
	terms!: Table<IndexedTerm>;
	folders!: Table<IndexedFolder>;

	constructor(name: string) {
		super(name);

		this.version(1).stores({
			documents: '++id, path, fileName, lastModified',
			folders: '++id, path, name',
			terms: '[term+documentId+source], term, documentId, folderId, source, frequency',
		});
	}
}
