import { tool } from 'ai';
import { z } from 'zod';
import type StewardPlugin from 'src/main';
import { TFile, TFolder } from 'obsidian';

/**
 * Schema for the grep tool parameters
 */
export const grepSchema = z.object({
  paths: z
    // Remove trailing slash from paths
    .array(z.string().transform(val => val.replace(/\/$/, '')))
    .min(1)
    .describe(
      'Array of file or folder paths to check for existence. Can also include a single file path to search content in.'
    ),
  contentPattern: z
    .string()
    .optional()
    .describe(
      `The text pattern to search for in note content. Can be a simple string or regex pattern. Only used when checking content in a single file.
NOTE: ContentPattern can only be used when 'paths' is file paths, NOT folder paths.`
    ),
  explanation: z
    .string()
    .describe(
      'A brief explanation of why checking these paths or searching for this contentPattern is necessary.'
    ),
});

/**
 * Type for grep tool arguments
 */
export type GrepArgs = z.infer<typeof grepSchema>;

/**
 * Shared grep tool definition
 */
export const grepTool = tool({
  parameters: grepSchema,
});

/**
 * Result type for file/folder existence check
 */
export interface PathExistenceResult {
  path: string;
  exists: boolean;
  type: 'file' | 'folder' | null;
}

/**
 * Result type for grep content search
 */
export interface GrepContentResult {
  contentPattern: string;
  filePath: string;
  totalMatches: number;
  matches: Array<{
    content: string;
    fromLine: number;
    toLine: number;
  }>;
  error?: string;
}

/**
 * Combined result type for grep tool
 */
export type GrepResult = {
  paths?: PathExistenceResult[];
  content?: GrepContentResult;
};

/**
 * Check if names exist and determine their type (file or folder)
 */
async function checkNameExistence(
  paths: string[],
  plugin: StewardPlugin
): Promise<PathExistenceResult[]> {
  const results: PathExistenceResult[] = [];

  for (const name of paths) {
    const abstractFile =
      plugin.app.vault.getAbstractFileByPath(name) ||
      (await plugin.mediaTools.findFileByNameOrPath(name));

    if (!abstractFile) {
      results.push({
        path: name,
        exists: false,
        type: null,
      });
      continue;
    }

    // Determine if it's a file or folder
    const isFile = abstractFile instanceof TFile;
    const isFolder = abstractFile instanceof TFolder;

    results.push({
      path: abstractFile.path,
      exists: true,
      type: isFile ? 'file' : isFolder ? 'folder' : null,
    });
  }

  return results;
}

/**
 * Execute grep content search in a single file
 */
async function executeContentSearch(
  filePath: string,
  contentPattern: string,
  plugin: StewardPlugin
): Promise<GrepContentResult> {
  // Find the file to search in
  const file = await plugin.mediaTools.findFileByNameOrPath(filePath);

  if (!file) {
    return {
      contentPattern,
      filePath,
      totalMatches: 0,
      matches: [],
      error: `Note not found: ${filePath}`,
    };
  }

  // Read file content
  const content = await plugin.app.vault.cachedRead(file);

  // Create regex pattern (escape special characters if not already a regex)
  let searchPattern: RegExp;
  try {
    // Try to use as regex first
    searchPattern = new RegExp(contentPattern, 'gi');
  } catch {
    // If regex fails, escape special characters and search as literal string
    const escapedPattern = contentPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchPattern = new RegExp(escapedPattern, 'gi');
  }

  const matches: GrepContentResult['matches'] = [];

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

  const result: GrepContentResult = {
    contentPattern,
    filePath: file.path,
    totalMatches: matches.length,
    matches,
  };

  return result;
}

/**
 * Execute grep tool - checks path existence or searches content
 */
export async function execute(args: GrepArgs, plugin: StewardPlugin): Promise<GrepResult> {
  const { paths, contentPattern } = args;

  // If contentPattern is provided and only one path, search content
  if (contentPattern && paths.length === 1) {
    const contentResult = await executeContentSearch(paths[0], contentPattern, plugin);
    return {
      content: contentResult,
    };
  }

  // Otherwise, check name existence
  const pathResults = await checkNameExistence(paths, plugin);
  return {
    paths: pathResults,
  };
}
