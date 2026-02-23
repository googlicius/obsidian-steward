/**
 * Utilities for the "step processed" query format.
 * Used when a to-do step is handled client-side (e.g. command syntax) so the next
 * iteration can recognize it and update the todo list without involving the AI.
 */
const QUERY_PROCESSED_PLACEHOLDER = '__QUERY_PROCESSED__';

/**
 * Prefix the original query with a placeholder to mark it as client-processed.
 * Returns originalQuery as-is if it already contains the placeholder.
 */
export function createStepProcessedQuery(originalQuery: string): string {
  if (originalQuery.startsWith(QUERY_PROCESSED_PLACEHOLDER)) {
    return originalQuery;
  }
  return `${QUERY_PROCESSED_PLACEHOLDER}${originalQuery}`;
}

/**
 * Parse a query and extract the original query if it has the processed placeholder prefix.
 * @returns The original query (content after the placeholder), or null if the format does not match.
 */
export function parseStepProcessedQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed.startsWith(QUERY_PROCESSED_PLACEHOLDER)) {
    return null;
  }
  return trimmed.slice(QUERY_PROCESSED_PLACEHOLDER.length);
}
