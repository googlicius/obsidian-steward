/**
 * Checks if the input string is wrapped in matching quotation marks ("" or '')
 * after trimming, treating it as a properly quoted string (with support for
 * escaped inner quotes). If so, returns the inner content (non-empty); otherwise,
 * returns null.
 *
 * @param input The input string to check.
 * @returns The inner quoted string if valid and wrapped in matching quotes, or null.
 */
export function getQuotedQuery(input: string): string | null {
  const trimmed = input.trim();

  const quote = trimmed[0];

  if (quote !== '"' && quote !== "'") {
    return null;
  }

  // Check if the string ends with the same quote character
  if (trimmed[trimmed.length - 1] !== quote) {
    return null;
  }

  // Create regex based on the quote type
  const regex = new RegExp(`^${quote}(?:[^${quote}\\\\]*(?:\\\\.[^${quote}\\\\]*)*)${quote}$`);

  if (trimmed.match(regex)) {
    const inner = trimmed.slice(1, -1);
    return inner.length > 0 ? inner : null;
  }

  return null;
}
