import { Condition, ConditionResult } from './Condition';
import { logger } from 'src/utils/logger';
import { SearchContext } from './SearchContext';

export interface QueryResult<T> {
  conditionResults: ConditionResult<T>[];
  count: number;
}

export class QueryExecutor {
  constructor(private context: SearchContext) {}

  async execute<T>(condition: Condition<T>): Promise<QueryResult<T>> {
    try {
      const resultMap = await condition.injectContext(this.context).evaluate();
      if (resultMap.size === 0) return { conditionResults: [], count: 0 };

      // Convert map to array and sort by score descending
      const sortedResults = Array.from(resultMap.entries())
        .sort((a, b) => b[1].score - a[1].score) // Higher score first; adjust if needed
        .map(entry => entry[1]);

      return { conditionResults: sortedResults, count: sortedResults.length };
    } catch (error) {
      logger.error('Query execution failed:', error);
      return { conditionResults: [], count: 0 };
    }
  }
}
