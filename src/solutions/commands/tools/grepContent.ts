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
    .describe('The path of the file to search in. If not provided, leave it empty.'),
  contextLines: z
    .number()
    .optional()
    .default(2)
    .describe('Number of lines before and after each match to include in the result (default: 2).'),
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
  success: boolean;
  pattern: string;
  filePath?: string;
  totalMatches: number;
  matches: Array<{
    lineNumber: number;
    content: string;
    context: Array<{
      lineNumber: number;
      content: string;
      isMatch: boolean;
    }>;
  }>;
  error?: string;
}

/**
 * Execute grep content search
 */
export async function execute(args: GrepArgs, plugin: StewardPlugin): Promise<GrepResult | null> {
  const { pattern, filePath, contextLines = 2 } = args;

  // Find the file to search in
  const file = filePath
    ? await plugin.mediaTools.findFileByNameOrPath(filePath)
    : plugin.app.workspace.getActiveFile();

  if (!file) {
    return null;
  }

  try {
    // Read file content
    const content = await plugin.app.vault.read(file);
    const lines = content.split('\n');

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

    // Search for matches
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (searchPattern.test(line)) {
        const startLine = Math.max(0, i - contextLines);
        const endLine = Math.min(lines.length - 1, i + contextLines);

        const context = lines.slice(startLine, endLine + 1).map((contextLine, index) => {
          const actualLineNumber = startLine + index + 1;
          return {
            lineNumber: actualLineNumber,
            content: contextLine,
            isMatch: actualLineNumber === i + 1,
          };
        });

        matches.push({
          lineNumber: i + 1,
          content: line,
          context,
        });
      }
    }

    // Return null if no matches found
    if (matches.length === 0) {
      return null;
    }

    const result: GrepResult = {
      success: true,
      pattern,
      filePath: file.path,
      totalMatches: matches.length,
      matches,
    };

    return result;
  } catch (error) {
    return null;
  }
}
