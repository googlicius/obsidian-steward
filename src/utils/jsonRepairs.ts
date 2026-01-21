/**
 * Fix unquoted JSON strings that are not valid JSON.
 * A human solution to provide a placeholder for the {{...}} patterns after several retries with Opus 4.5.
 */
export function fixUnquotedJSON(broken: string): string {
  // Step 1: Temporarily remove {{...}} patterns to avoid confusion with JSON braces
  const placeholders: string[] = [];
  const withoutTemplates = broken.replace(/\{\{[^}]*\}\}/g, match => {
    placeholders.push(match);
    return `__PLACEHOLDER_${placeholders.length - 1}__`;
  });

  // Step 2: Fix unquoted string values
  const fixed = withoutTemplates
    .replace(/:\s*([^"{[}\]\s][^,}\]\n]*)/g, (match, value) => {
      const trimmed = value.trim();
      // Already looks like number/null/true/false → leave as is
      if (/^[0-9-]|^true$|^false$|^null$/.test(trimmed)) {
        return match;
      }
      // Wrap the captured value in quotes
      return `: "${trimmed}"`;
    })
    // Collapse trailing whitespace/newlines before closing braces
    .replace(/\s+([}\]])/g, '$1');

  // Step 3: Restore {{...}} patterns
  return fixed.replace(/__PLACEHOLDER_(\d+)__/g, (_, index) => placeholders[parseInt(index)]);
}
