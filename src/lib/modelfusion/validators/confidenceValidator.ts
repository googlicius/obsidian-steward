/**
 * Validates that the confidence score is a number between 0 and 1.
 * If the confidence is not provided or invalid, throws an error
 * @param confidence The confidence score to validate
 * @returns A valid confidence score
 * @throws Error if the confidence score is invalid
 */
export function validateConfidence(confidence: any): number {
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error('Confidence must be a number between 0 and 1');
  }
  return confidence;
}
