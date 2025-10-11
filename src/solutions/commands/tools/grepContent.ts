import { tool } from 'ai';
import { z } from 'zod';
import type StewardPlugin from 'src/main';

/**
 * Schema for the grep tool parameters
 */
const grepSchema = z.object({
  pattern: z
    .string()
    .describe(
      'The text pattern to search for in the note content. Can be a simple string or regex pattern.'
    ),
  filePath: z
    .string()
    .optional()
    .describe('The path of the note to search in. If not provided, leave it empty.'),
  explanation: z
    .string()
    .describe('A brief explanation of why searching for this pattern is necessary.'),
});

/**
 * Type for grep tool arguments
 */
export type GrepArgs = z.infer<typeof grepSchema>;

/**
 * Tool name constant for grep
 */
export const GREP_TOOL_NAME = 'grep';

/**
 * Shared grep tool definition
 */
export const grepTool = tool({
  parameters: grepSchema,
});

/**
 * Result type for grep search
 */
export interface GrepResult {
  pattern: string;
  filePath?: string;
  totalMatches: number;
  matches: Array<{
    content: string;
    fromLine: number;
    toLine: number;
  }>;
}

/**
 * Execute grep content search
 */
export async function execute(args: GrepArgs, plugin: StewardPlugin): Promise<GrepResult> {
  const { pattern, filePath } = args;

  // Find the file to search in
  const file = filePath
    ? await plugin.mediaTools.findFileByNameOrPath(filePath)
    : plugin.app.workspace.getActiveFile();

  if (!file) {
    throw new Error(`Note not found: ${filePath}`);
  }

  // Read file content
  const content = await plugin.app.vault.cachedRead(file);

  // Create regex pattern (escape special characters if not already a regex)
  let searchPattern: RegExp;
  try {
    // Try to use as regex first
    searchPattern = new RegExp(pattern, 'gi');
  } catch {
    // If regex fails, escape special characters and search as literal string
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchPattern = new RegExp(escapedPattern, 'gi');
  }

  const matches: GrepResult['matches'] = [];

  // Reset regex for global search
  searchPattern.lastIndex = 0;

  // Search for matches in the full content
  let match;
  while ((match = searchPattern.exec(content)) !== null) {
    const matchStart = match.index;
    const matchedContent = match[0];

    // Calculate line numbers for the match
    const beforeMatch = content.substring(0, matchStart);
    const fromLine = beforeMatch.split('\n').length - 1;

    // Calculate toLine by counting newlines in the matched content
    const newlinesInMatch = (matchedContent.match(/\n/g) || []).length;
    const toLine = fromLine + newlinesInMatch;

    matches.push({
      content: matchedContent,
      fromLine,
      toLine,
    });

    // Prevent infinite loop on zero-length matches
    if (match[0].length === 0) {
      searchPattern.lastIndex++;
    }
  }

  const result: GrepResult = {
    pattern,
    filePath: file.path,
    totalMatches: matches.length,
    matches,
  };

  return result;
}
