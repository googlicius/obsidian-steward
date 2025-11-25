/**
 * List of common English stopwords to filter out from search
 */
export const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'if',
  'in',
  'into',
  'is',
  'it',
  'no',
  'not',
  'of',
  'on',
  'or',
  'such',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'will',
  'with',

  // Some specific markdown formatting words
  '*',
  '**',
  '***',
  '---',
  '```',
  '#',
  '##',
  '###',
  '####',
  '#####',
  '######',

  // Some specific characters
  '-',
  '_',
  '`',
  '~',
  '|',
  '{',
  '}',
  '[',
  ']',
  '(',
  ')',
  '"',
  "'",
  '\\',
  '/',
  '@',
]);

/**
 * Removes stopwords from an array of words
 * @param words Array of words to filter
 * @param threshold Threshold for stopword removal (0.0 to 1.0). If the percentage of stopwords exceeds this threshold,
 *                  only remove stopwords until the percentage is below the threshold. If not provided, removes all stopwords.
 * @returns Array with stopwords removed (partially or fully based on threshold)
 */
export function removeStopwords(words: string[], threshold?: number): string[] {
  if (!threshold) {
    // Default behavior: remove all stopwords
    return words.filter(word => !STOPWORDS.has(word));
  }

  const totalWords = words.length;
  if (totalWords === 0) {
    return words;
  }

  // Identify stopwords and their indices
  const stopwordIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (STOPWORDS.has(words[i])) {
      stopwordIndices.push(i);
    }
  }

  const stopwordCount = stopwordIndices.length;
  const stopwordPercentage = stopwordCount / totalWords;

  // If stopword percentage is below threshold, remove all stopwords
  if (stopwordPercentage <= threshold) {
    return words.filter(word => !STOPWORDS.has(word));
  }

  // If stopword percentage exceeds threshold, remove stopwords until percentage is below threshold
  // Calculate how many stopwords we can remove while staying below threshold
  // We want: (stopwordCount - removedCount) / (totalWords - removedCount) <= threshold
  // Solving for removedCount: removedCount >= (stopwordCount - threshold * totalWords) / (1 - threshold)
  const minRemovedCount = Math.ceil((stopwordCount - threshold * totalWords) / (1 - threshold));

  // Ensure we don't remove all words - keep at least 1 word total
  // So we can remove at most (totalWords - 1) words
  const stopwordsToRemove = Math.max(0, Math.min(minRemovedCount, stopwordCount, totalWords - 1));

  // Remove stopwords from the end first to preserve beginning context
  // Create a set of indices to remove (take from the end of stopwordIndices)
  const indicesToRemove = new Set(
    stopwordIndices.slice(stopwordIndices.length - stopwordsToRemove)
  );

  return words.filter((_, index) => {
    // Always keep non-stopwords
    if (!STOPWORDS.has(words[index])) {
      return true;
    }
    // For stopwords, only keep if not in indicesToRemove
    return !indicesToRemove.has(index);
  });
}
