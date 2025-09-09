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
   */
  abstract evaluate(): Promise<Map<number, ConditionResult<T>>>;
}
