import type { StepCondition } from './versions/types';

export interface StepConditionContext {
  cleanedUserInput: string;
}

function isValidRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that regex patterns in step conditions compile.
 */
export function assertValidStepConditionPattern(pattern: string): void {
  if (!isValidRegexPattern(pattern)) {
    throw new Error(`step condition pattern must be a valid regex: ${pattern}`);
  }
}

/**
 * Evaluate a single step condition against user input.
 */
export function evaluateStepCondition(
  condition: StepCondition,
  context: StepConditionContext
): boolean {
  if (condition === 'empty_from_user') {
    return context.cleanedUserInput.trim().length === 0;
  }

  if ('matches' in condition) {
    return new RegExp(condition.matches).test(context.cleanedUserInput);
  }

  if ('not_matches' in condition) {
    return !new RegExp(condition.not_matches).test(context.cleanedUserInput);
  }

  return false;
}

/**
 * Evaluate step `when` conditions. Missing or empty → always run (true).
 * Multiple conditions use OR semantics.
 */
export function evaluateStepWhen(
  when: StepCondition | StepCondition[] | undefined,
  context: StepConditionContext
): boolean {
  if (when === undefined) {
    return true;
  }

  const conditions = Array.isArray(when) ? when : [when];
  if (conditions.length === 0) {
    return true;
  }

  for (const condition of conditions) {
    if (evaluateStepCondition(condition, context)) {
      return true;
    }
  }

  return false;
}
