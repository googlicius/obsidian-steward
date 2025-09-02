import Dexie, { Table } from 'dexie';
import { logger } from '../utils/logger';

/**
 * Document in the search index
 */
export interface IndexedDocument {
  id?: number; // Auto-incremented document ID
  path: string; // File path as unique ID
  fileName: string; // File name without extension (lowercase)
  lastModified: number; // Timestamp of last modification
  tags: string[]; // Tags array (legacy - tags are now primarily handled as properties)
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
 * Property (key-value pair) for a document.
 * Values are normalized to strings; arrays are stored as multiple entries.
 */
export interface IndexedProperty {
  id?: number; // Auto-incremented ID
  documentId: number; // Foreign key to documents.id
  name: string; // Property key (e.g., 'status', 'tags') - lowercase for consistency
  value: unknown; // Property value, could be any type
}

/**
 * Database class for the Obsidian Steward plugin
 */
export class SearchDatabase extends Dexie {
  documents!: Table<IndexedDocument>;
  terms!: Table<IndexedTerm>;
  folders!: Table<IndexedFolder>;
  properties!: Table<IndexedProperty>;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      documents: '++id, path, fileName, lastModified',
      folders: '++id, path, name',
      terms: '[term+documentId+source], term, documentId, folderId, source, frequency',
    });

    // New version 2: Add properties table
    this.version(2)
      .stores({
        documents: '++id, path, fileName, lastModified',
        folders: '++id, path, name',
        terms: '[term+documentId+source], term, documentId, folderId, source, frequency',
        properties: '++id, documentId, name, [name+value], value', // Indexes for efficient queries
      })
      .upgrade(async trans => {
        // No migration needed for properties table - it starts empty
        logger.log('Upgraded search database to version 2 with properties table');
      });
  }
}
