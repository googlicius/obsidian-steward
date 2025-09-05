import { Condition, ConditionResult } from './Condition';

/**
 * Filters the results of the previous condition.
 */
export abstract class Filter<T> extends Condition<T> {
  protected prevConditionResult: Map<number, ConditionResult>;

  injectConditionResult(prevConditionResult: Map<number, ConditionResult<T>>): this {
    this.prevConditionResult = prevConditionResult;
    return this;
  }
}
