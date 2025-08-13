/**
 * Escapes common Markdown special characters in a string by prepending a backslash.
 * This is useful for rendering text literally without Markdown processing.
 */
export function escapeMarkdown(text: string, escapeNewlines = false) {
  const specialChars = /[\\`*_{}[\]()#+-.!|>~^]/g;

  let escaped = text.replace(specialChars, '\\$&');

  if (escapeNewlines) {
    escaped = escaped.replace(/\n/g, '\\n');
  }

  return escaped;
}

/**
 * Unescapes Markdown special characters in a string by removing the prepended backslash.
 */
export function unescapeMarkdown(text: string) {
  const escapedChars = /\\(?=[`*_{}[\]()#+-.!|>~^])/g;

  return text.replace(escapedChars, '').replace(/\\n/g, '\n');
}
