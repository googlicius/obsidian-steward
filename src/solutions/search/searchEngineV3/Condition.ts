import { SearchContext } from './SearchContext';

export interface ConditionResult<T = unknown> {
  document: T;
  score: number;
  keywordsMatched?: string[];
}

export abstract class Condition<T = unknown> {
  protected context: SearchContext;

  /**
   * Inject the context into the condition.
   */
  injectContext(context: SearchContext): this {
    this.context = context;
    return this;
  }

  /**
   * Evaluate the condition.
   * Returns a promise of a Map where keys are document IDs and values contain the document and score.
   * For non-scoring conditions, use a default score like 1 (match) or 0 (no relevance).
   * @returns Promise<Map<number, ConditionResult>>
   */
  abstract evaluate(): Promise<Map<number, ConditionResult<T>>>;
}
