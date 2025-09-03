import { Condition, ConditionResult } from './Condition';

/**
 * Composite condition for OR logic.
 */
export class OrCondition extends Condition {
  private conditions: Condition[];

  constructor(...conditions: Condition[]) {
    super();
    this.conditions = conditions.filter(condition => condition !== undefined);
  }

  async evaluate() {
    const result = new Map<number, ConditionResult>();

    for (const condition of this.conditions) {
      const map = await condition.injectContext(this.context).evaluate();
      for (const [docId, resultData] of map) {
        if (result.has(docId)) {
          // Combine scores (e.g., sum for cumulative relevance); adjust if needed (e.g., Math.max)
          const existingResult = result.get(docId);
          if (existingResult) {
            result.set(docId, {
              document: resultData.document,
              score: existingResult.score + resultData.score,
            });
          }
        } else {
          result.set(docId, resultData);
        }
      }
    }
    return result;
  }
}
