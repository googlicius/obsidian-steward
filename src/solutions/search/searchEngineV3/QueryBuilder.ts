import { AndCondition } from './AndCondition';
import { Condition } from './Condition';
import { OrCondition } from './OrCondition';

/**
 * Generic QueryBuilder that allows adding any condition
 */
export class QueryBuilder<T = unknown> {
  private rootCondition: Condition<T>;

  and(condition: Condition<T>): this {
    if (this.rootCondition instanceof AndCondition) {
      this.rootCondition = new AndCondition(...this.rootCondition['conditions'], condition);
    } else {
      this.rootCondition = new AndCondition(this.rootCondition, condition);
    }
    return this;
  }

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
