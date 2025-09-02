import { Condition, ConditionResult } from './Condition';

/**
 * Composite condition for AND logic.
 */
export class AndCondition extends Condition {
  private conditions: Condition[];

  constructor(...conditions: Condition[]) {
    super();
    this.conditions = conditions;
  }

  async evaluate() {
    if (this.conditions.length === 0) return new Map();

    // Start with the first condition's results
    let result = await this.conditions[0].injectContext(this.context).evaluate();

    // Intersect with subsequent conditions, combining scores (e.g., sum for cumulative relevance)
    for (let i = 1; i < this.conditions.length; i++) {
      const nextMap = await this.conditions[i].injectContext(this.context).evaluate();
      const intersected = new Map<number, ConditionResult>();

      for (const [docId, resultData] of result) {
        const nextResult = nextMap.get(docId);
        if (nextResult !== undefined) {
          const combinedScore = resultData.score + nextResult.score; // Sum scores; adjust logic if needed (e.g., Math.max(score, nextScore) or score * nextScore for multiplicative)
          intersected.set(docId, {
            document: resultData.document,
            score: combinedScore,
          });
        }
      }
      result = intersected;
    }

    return result;
  }
}
