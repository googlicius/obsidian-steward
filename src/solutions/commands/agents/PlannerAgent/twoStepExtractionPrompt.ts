/**
 * Context description for the 2-step extraction process used in GeneralCommandHandler.
 * This provides the LLM with a complete understanding of how the extraction works
 * across both steps to make more informed decisions.
 */

export function twoStepExtractionPrompt(stepNumber: 1 | 2): string {
  return `This is step ${stepNumber} of a 2-step extraction process:

Step 1: Extract command types - Focus on identifying WHAT operations need to be performed
Step 2: Extract queries - Use query templates and guidelines to create specific queries for each command from step 1`;
}
