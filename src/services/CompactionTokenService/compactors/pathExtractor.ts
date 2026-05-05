/**
 * Extracts file paths from tool output (text or structured).
 * Handles Obsidian wikilinks [[path]] and [[path|alias]].
 */
export function extractPathsFromText(text: string | undefined | null): string[] {
  if (!text || typeof text !== 'string') return [];
  const paths: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  for (const match of text.matchAll(regex)) {
    if (match[1]) paths.push(match[1]);
  }
  return [...new Set(paths)];
}

/** Pattern for rename output: [[from]] → [[to]] */
const RENAME_PAIR_REGEX = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]\s*→\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Extracts rename pairs from text containing "[[from]] → [[to]]" patterns.
 */
export function extractRenamePairsFromText(
  text: string | undefined | null
): Array<{ from: string; to: string }> {
  if (!text || typeof text !== 'string') return [];
  const pairs: Array<{ from: string; to: string }> = [];
  for (const match of text.matchAll(RENAME_PAIR_REGEX)) {
    if (match[1] && match[2]) {
      pairs.push({ from: match[1], to: match[2] });
    }
  }
  return pairs;
}

/**
 * Extracts destination folder from copy/move operation text.
 * Handles "Operation N: Copying/Moving ... to {{folder}}" style messages.
 */
export function extractDestinationFromText(text: string | undefined | null): string | undefined {
  if (!text || typeof text !== 'string') return undefined;
  const match = text.match(/(?:Copying files|Moving items) to (.+?)(?:\n|$)/i);
  return match?.[1]?.trim();
}

const MAX_PATHS_PREVIEW = 5;

/**
 * Truncates a path array for compacted metadata and adds a note when truncated.
 */
export function truncatePathsWithNote(paths: string[]): {
  paths: string[];
  note?: string;
} {
  if (paths.length <= MAX_PATHS_PREVIEW) return { paths };
  return {
    paths: paths.slice(0, MAX_PATHS_PREVIEW),
    note: `${paths.length - MAX_PATHS_PREVIEW} more path(s) omitted; use recall_compacted_context for full list`,
  };
}

/**
 * Truncates an array of items (e.g. rename pairs) for compacted metadata and adds a note when truncated.
 */
export function truncateWithNote<T>(items: T[]): { items: T[]; note?: string } {
  if (items.length <= MAX_PATHS_PREVIEW) return { items };
  return {
    items: items.slice(0, MAX_PATHS_PREVIEW),
    note: `${items.length - MAX_PATHS_PREVIEW} more omitted; use recall_compacted_context for full list`,
  };
}
