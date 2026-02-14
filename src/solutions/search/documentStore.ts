import Dexie from 'dexie';
import * as chrono from 'chrono-node';
import type { App } from 'obsidian';
import {
  SearchDatabase,
  IndexedDocument,
  IndexedFolder,
  IndexedTerm,
  IndexedProperty,
} from '../../database/SearchDatabase';
import { logger } from '../../utils/logger';
import { IndexedPropertyArray } from './IndexedPropertyArray';
import type { PropertyOperator } from 'src/solutions/commands/agents/handlers/Search';

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

    // If the properties array is not already a IndexedPropertyArray, convert it
    if (!(properties instanceof IndexedPropertyArray)) {
      const indexedProperties = new IndexedPropertyArray(...properties);
      await this.db.properties.bulkAdd(indexedProperties);
    } else {
      await this.db.properties.bulkAdd(properties);
    }
  }

  /**
   * Get properties for a document
   */
  public async getPropertiesByDocumentId(documentId: number): Promise<IndexedProperty[]> {
    return this.db.properties.where('documentId').equals(documentId).toArray();
  }

  /**
   * Get documents by property name and value.
   * Handles type coercion between string and number to account for
   * mismatches between how values are stored (from YAML) and queried.
   */
  public async getDocumentsByProperty(name: string, value: unknown): Promise<IndexedDocument[]> {
    // Convert name to lowercase for consistency
    const lowerName = name.toLowerCase();

    let properties: IndexedProperty[] = [];

    if (typeof value === 'string' || typeof value === 'number') {
      // Build all possible representations of the value to query at once.
      // This handles type mismatches between stored values (from YAML parsing)
      // and query values (from AI or user input).
      const valuesToQuery: Array<[string, string | number]> = [];

      if (typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        valuesToQuery.push([lowerName, lowerValue]);

        // Also try the numeric representation if the string is a valid number
        const numericValue = Number(lowerValue);
        if (!isNaN(numericValue)) {
          valuesToQuery.push([lowerName, numericValue]);
        }

        // Also try date parsing (ISO 8601 or natural language like "yesterday", "last week")
        const parsedDate = DocumentStore.parseDate(lowerValue);
        if (parsedDate && parsedDate !== lowerValue) {
          valuesToQuery.push([lowerName, parsedDate]);
        }
      } else {
        // value is a number
        valuesToQuery.push([lowerName, value]);
        valuesToQuery.push([lowerName, String(value)]);
      }

      // Use the compound index with anyOf to query all possible values at once
      properties = await this.db.properties.where('[name+value]').anyOf(valuesToQuery).toArray();
    } else {
      // For complex types, fall back to manual filtering
      properties = await this.db.properties
        .where('name')
        .equals(lowerName)
        .and(prop => prop.value === value)
        .toArray();
    }

    if (properties.length === 0) return [];

    // Get unique document IDs
    const documentIds = [...new Set(properties.map(p => p.documentId))];

    // Return the documents
    return this.getDocumentsByIds(documentIds);
  }

  /**
   * ISO 8601 date/datetime pattern.
   * Matches: YYYY-MM-DD and YYYY-MM-DDTHH:mm:ss (with optional timezone)
   */
  private static readonly ISO_DATE_REGEX =
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

  /**
   * Format a Date object as an ISO 8601 date string (YYYY-MM-DD).
   */
  private static formatDateToISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Parse a string value into an ISO 8601 date string.
   * Supports ISO 8601 formats directly, and natural language expressions
   * like "yesterday", "last week", "2 days ago" via chrono-node.
   * Returns null if the value cannot be parsed as a date.
   */
  private static parseDate(value: string): string | null {
    // Already ISO 8601 — return as-is
    if (DocumentStore.ISO_DATE_REGEX.test(value)) {
      return value;
    }

    // Try natural language parsing via chrono-node
    const parsed = chrono.parseDate(value);
    if (parsed) {
      return DocumentStore.formatDateToISO(parsed);
    }

    return null;
  }

  /**
   * Resolve a value into a comparable form for range/inequality operators.
   * Returns a number if the value is numeric, an ISO 8601 date string if it
   * is a valid date (including natural language), or null if neither.
   */
  private resolveComparableValue(value: unknown): number | string | null {
    if (typeof value === 'number') {
      return value;
    }

    if (typeof value !== 'string') {
      return null;
    }

    // Try numeric first
    const numericValue = Number(value);
    if (!isNaN(numericValue)) {
      return numericValue;
    }

    // Try date parsing (ISO 8601 or natural language)
    return DocumentStore.parseDate(value);
  }

  /**
   * Get documents by property name, value, and comparison operator.
   * Supports: ==, !=, >, <, >=, <=
   * For '==', delegates to getDocumentsByProperty.
   * Range operators (>, <, >=, <=) use Dexie's between() on the [name+value] compound index.
   * Works with both numeric values and ISO 8601 date/datetime strings.
   */
  public async getDocumentsByPropertyWithOperator(
    name: string,
    value: unknown,
    operator: PropertyOperator
  ): Promise<IndexedDocument[]> {
    if (operator === '==') {
      return this.getDocumentsByProperty(name, value);
    }

    const lowerName = name.toLowerCase();

    const comparableValue = this.resolveComparableValue(value);
    if (comparableValue === null) {
      logger.warn(
        `Cannot use operator "${operator}" with value "${value}" for property "${name}".`
      );
      return [];
    }

    let properties: IndexedProperty[] = [];

    switch (operator) {
      case '>':
        properties = await this.db.properties
          .where('[name+value]')
          .between([lowerName, comparableValue], [lowerName, Dexie.maxKey], false, true)
          .toArray();
        break;

      case '>=':
        properties = await this.db.properties
          .where('[name+value]')
          .between([lowerName, comparableValue], [lowerName, Dexie.maxKey], true, true)
          .toArray();
        break;

      case '<':
        properties = await this.db.properties
          .where('[name+value]')
          .between([lowerName, Dexie.minKey], [lowerName, comparableValue], true, false)
          .toArray();
        break;

      case '<=':
        properties = await this.db.properties
          .where('[name+value]')
          .between([lowerName, Dexie.minKey], [lowerName, comparableValue], true, true)
          .toArray();
        break;

      case '!=':
        properties = await this.db.properties
          .where('name')
          .equals(lowerName)
          .and(prop => prop.value !== comparableValue)
          .toArray();
        break;
    }

    if (properties.length === 0) return [];

    // Get unique document IDs
    const documentIds = [...new Set(properties.map(p => p.documentId))];

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
