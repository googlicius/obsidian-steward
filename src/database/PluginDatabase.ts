import Dexie, { Table } from 'dexie';

/**
 * Document in the search index
 */
export interface IndexedDocument {
	id: string; // File path as unique ID
	fileName: string; // File name without extension
	path: string; // Full path to file
	content: string; // Raw file content
	lastModified: number; // Timestamp of last modification
	tags: string[]; // Tags extracted from content and frontmatter
}

/**
 * Term in the inverted index
 */
export interface IndexedTerm {
	term: string; // The indexed term
	documentId: string; // ID of document containing the term
	frequency: number; // Number of occurrences in the document
	positions: number[]; // Positions in the document
}

/**
 * Database class for the Obsidian Steward plugin
 */
export class PluginDatabase extends Dexie {
	documents!: Table<IndexedDocument>;
	terms!: Table<IndexedTerm>;

	constructor(name: string) {
		super(name);

		this.version(1).stores({
			documents: 'id, fileName, path, lastModified',
			terms: '[term+documentId], term, documentId, frequency',
		});
	}
}
