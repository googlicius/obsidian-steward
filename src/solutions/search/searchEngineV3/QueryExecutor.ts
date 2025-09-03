import { IndexedDocument } from 'src/database/SearchDatabase';
import { Condition } from './Condition';
import { logger } from 'src/utils/logger';
import { SearchContext } from './SearchContext';

/**
 * Interface for query results (array of matching documents with optional metadata)
 */
export interface QueryResult {
  documents: IndexedDocument[];
  count: number;
}

/**
 * Updated Executor class (uses DocumentStore for fetching).
 */
export class QueryExecutor {
  constructor(private context: SearchContext) {}

  async execute(condition: Condition): Promise<QueryResult> {
    try {
      const resultMap = await condition.injectContext(this.context).evaluate();
      if (resultMap.size === 0) return { documents: [], count: 0 };

      // Convert map to array and sort by score descending
      const sortedDocuments = Array.from(resultMap.entries())
        .sort((a, b) => b[1].score - a[1].score) // Higher score first; adjust if needed
        .map(entry => entry[1].document);

      return { documents: sortedDocuments, count: sortedDocuments.length };
    } catch (error) {
      logger.error('Query execution failed:', error);
      return { documents: [], count: 0 };
    }
  }
}
