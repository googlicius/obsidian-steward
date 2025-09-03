import { IndexedDocument } from 'src/database/SearchDatabase';
import { SearchContext } from './SearchContext';

/**
 * Result structure for condition evaluation
 */
export interface ConditionResult {
  document: IndexedDocument;
  score: number;
  keywordsMatched?: string[];
}

/**
 * Abstract base class for all conditions.
 * Subclasses implement specific filtering logic.
 */
export abstract class Condition {
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
  abstract evaluate(): Promise<Map<number, ConditionResult>>;
}
