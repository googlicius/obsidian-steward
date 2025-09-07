/**
 * Check the proximity of all query terms with the given threshold
 */
export function termsProximity(
  termPositions: Map<string, number[]>,
  queryTerms: string[],
  proximityThreshold = 10
): {
  isProximity: boolean;
  minDistances: number[];
} {
  // DATA STRUCTURE
  // A stack for backtracking
  // A remaining array of unique terms

  // SOLUTION
  // Steps:
  // 0. Define index = 0, remainingTerms = queryTerms, stack = []
  // 1. Move a item at the index of the remainingTerms to the stack
  // 1.1 Check it (stack[last]) against all items in the remainingTerms, increase the index accordingly
  // 2.1 If they're close, reset the index = 0, repeat (1)
  // 2.2 If they're not, remove the last item from the stack, reset index = 0, repeat step 1.1
  // 2.3 If all remainingTerms are checked with the last item in the stack but not any close, exit fail.

  /**
   * Check proximity between 2 terms
   */
  function calcDistance(term1: string, term2: string): number {
    const positions = termPositions.get(term1) || [];
    const nextPositions = termPositions.get(term2) || [];

    const farthestPositionOfThisTerm = Math.max(...positions);
    const closestPositionOfNextTerm = Math.min(...nextPositions);

    // For backward traversal
    const closestPositionOfThisTerm = Math.min(...positions);
    const farthestPositionOfNextTerm = Math.max(...nextPositions);

    const distance = Math.min(
      Math.abs(closestPositionOfNextTerm - farthestPositionOfThisTerm),
      Math.abs(farthestPositionOfNextTerm - closestPositionOfThisTerm)
    );

    return distance;
  }

  let index = 0;
  const minDistances: number[] = [];
  const remainingTerms = [...new Set(queryTerms)];

  const stack = [remainingTerms[index]];
  remainingTerms.splice(0, 1);

  while (remainingTerms.length > 0 && stack.length > 0) {
    const term = stack[stack.length - 1];
    const nextTerm = remainingTerms[index];

    const distance = calcDistance(term, nextTerm);

    if (distance > proximityThreshold) {
      if (index < remainingTerms.length - 1) {
        index++;
      } else {
        stack.pop();
        index = 0;
      }
    } else {
      // Move term from the remainingTerms to the stack
      stack.push(nextTerm);
      remainingTerms.splice(index, 1);
      // Collect distances
      minDistances.push(distance);
      // Reset index
      index = 0;
    }
  }

  return {
    isProximity: remainingTerms.length === 0,
    minDistances,
  };
}
