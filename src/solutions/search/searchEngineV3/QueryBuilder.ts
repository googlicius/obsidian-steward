import { AndCondition } from './AndCondition';
import { Condition } from './Condition';
import { OrCondition } from './OrCondition';

/**
 * Generic QueryBuilder that allows adding any condition without business-specific methods.
 * Dependencies are provided through SearchContext to all conditions.
 */
export class QueryBuilder {
  private rootCondition: Condition;

  constructor() {
    this.rootCondition = new AndCondition();
  }

  /**
   * Add a condition with AND logic
   */
  and(condition: Condition): this {
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
  or(condition: Condition): this {
    if (this.rootCondition instanceof OrCondition) {
      this.rootCondition = new OrCondition(...this.rootCondition['conditions'], condition);
    } else {
      this.rootCondition = new OrCondition(this.rootCondition, condition);
    }
    return this;
  }

  build(): Condition {
    return this.rootCondition;
  }
}
