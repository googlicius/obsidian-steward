import Dexie, { Table } from 'dexie';

export interface LLMCacheEntry {
  id?: number;
  query: string;
  response: string;
  commandType: string;
  createdAt: number;
  lastAccessed: number;
  matchType: 'exact' | 'similarity';
  similarityScore?: number;
}

export class LLMCacheDatabase extends Dexie {
  exactMatches!: Table<LLMCacheEntry>;
  similarityMatches!: Table<LLMCacheEntry>;

  constructor() {
    super('llm-cache');

    this.version(1).stores({
      exactMatches: '++id, query, commandType, createdAt, lastAccessed',
      similarityMatches: '++id, query, commandType, createdAt, lastAccessed, similarityScore',
    });
  }
}
