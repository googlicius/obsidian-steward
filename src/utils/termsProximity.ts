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
   * Minimum distance between 2 terms
   * Optimized approach using two pointers - O(m + n) time complexity
   */
  function calMinDistance(term1: string, term2: string): number {
    const positions = termPositions.get(term1) || [];
    const nextPositions = termPositions.get(term2) || [];

    let i = 0;
    let j = 0;
    let minDistance = Infinity;

    while (i < positions.length && j < nextPositions.length) {
      const distance = Math.abs(positions[i] - nextPositions[j]);
      minDistance = minDistance ? Math.min(minDistance, distance) : distance;

      if (positions[i] < nextPositions[j]) {
        i++;
      } else {
        j++;
      }
    }

    return minDistance;
  }

  let index = 0;
  const minDistances: number[] = [];
  // Filter out terms that don't exist in termPositions
  const remainingTerms = [...new Set(queryTerms)].filter(term => termPositions.has(term));

  if (remainingTerms.length === 0) {
    return {
      isProximity: false,
      minDistances: [],
    };
  }

  const stack = [remainingTerms[index]];
  remainingTerms.splice(0, 1);

  while (remainingTerms.length > 0 && stack.length > 0) {
    const term = stack[stack.length - 1];
    const nextTerm = remainingTerms[index];

    const distance = calMinDistance(term, nextTerm);

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
