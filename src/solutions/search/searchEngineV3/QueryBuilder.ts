import { AndCondition } from './AndCondition';
import { Condition } from './Condition';
import { OrCondition } from './OrCondition';

/**
 * Generic QueryBuilder that allows adding any condition without business-specific methods.
 * Dependencies are provided through SearchContext to all conditions.
 */
export class QueryBuilder<T = unknown> {
  private rootCondition: Condition<T>;

  /**
   * Add a condition with AND logic
   */
  and(condition: Condition<T>): this {
    if (this.rootCondition instanceof AndCondition) {
      this.rootCondition = new AndCondition(...this.rootCondition['conditions'], condition);
    } else {
      this.rootCondition = new AndCondition(this.rootCondition, condition);
    }
    return this;
  }

  /**
   * Add a condition with OR logic
   */
  or(condition: Condition<T>): this {
    if (this.rootCondition instanceof OrCondition) {
      this.rootCondition = new OrCondition(...this.rootCondition['conditions'], condition);
    } else {
      this.rootCondition = new OrCondition(this.rootCondition, condition);
    }
    return this;
  }

  build(): Condition<T> {
    return this.rootCondition || new AndCondition();
  }
}
