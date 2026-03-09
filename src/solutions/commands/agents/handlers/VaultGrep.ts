import { tool } from 'ai';
import { normalizePath, TFile, TFolder } from 'obsidian';
import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { removeUndefined } from 'src/utils/removeUndefined';

export const grepSchema = z.object({
  contentPattern: z
    .string()
    .min(1)
    .describe(
      "The search content pattern to match against file CONTENTS only. Supports regex (e.g. 'function\\s+myFn') or literal strings."
    ),
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Files, directories, or glob patterns to search within (e.g. ['src/', '**/*.ts']). Defaults to the entire working directory if omitted."
    ),
  caseSensitive: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether the pattern match is case-sensitive. Defaults to true.'),
  isRegex: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, pattern is treated as a regular expression. If false, it's a literal string search."
    ),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(0)
    .describe('Number of lines of context to include before and after each match.'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe('Maximum number of matches to return. Prevents context window overflow.'),
});

export type GrepToolArgs = z.infer<typeof grepSchema>;

export type GrepMatch = {
  file: string;
  line: number;
  content: string;
  contextBefore?: string[];
  contextAfter?: string[];
};

export type GrepOutput = {
  matches: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
  searchedFiles: number;
};

export class VaultGrep {
  private static readonly grepTool = tool({ inputSchema: grepSchema });

  constructor(private readonly agent: AgentHandlerContext) {}

  public extractPathsForGuardrails(input: GrepToolArgs): string[] {
    if (!input.paths || input.paths.length === 0) {
      return [];
    }

    return input.paths.map(p => normalizePath(p));
  }

  public static getGrepTool() {
    return VaultGrep.grepTool;
  }

  private async executeGrep(args: GrepToolArgs): Promise<GrepOutput> {
    const files = await this.resolveFilesForGrep({ paths: args.paths });
    const searchRegex = this.createSearchRegex({
      pattern: args.contentPattern,
      isRegex: args.isRegex,
      caseSensitive: args.caseSensitive,
    });

    const matches: GrepMatch[] = [];
    let totalMatches = 0;

    for (const file of files) {
      const fileContent = await this.readFileContent(file);
      if (fileContent === null) {
        continue;
      }

      const fileLines = fileContent.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < fileLines.length; lineIndex += 1) {
        const lineContent = fileLines[lineIndex];
        searchRegex.lastIndex = 0;
        if (!searchRegex.test(lineContent)) {
          continue;
        }

        totalMatches += 1;
        if (matches.length >= args.maxResults) {
          continue;
        }

        const result = this.createMatchResult({
          filePath: file.path,
          lineContent,
          lineIndex,
          fileLines,
          contextLines: args.contextLines,
        });

        matches.push(result);
      }
    }

    return {
      matches,
      totalMatches,
      truncated: totalMatches > args.maxResults,
      searchedFiles: files.length,
    };
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<GrepToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;

    if (!params.handlerId) {
      throw new Error('VaultGrep.handle invoked without handlerId');
    }

    const result = await this.executeGrep(toolCall.input);

    await this.agent.renderer.serializeToolInvocation({
      path: params.title,
      command: 'vault_grep',
      handlerId: params.handlerId,
      step: params.invocationCount,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: removeUndefined(result),
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private createMatchResult(params: {
    filePath: string;
    lineContent: string;
    lineIndex: number;
    fileLines: string[];
    contextLines: number;
  }): GrepMatch {
    const { filePath, lineContent, lineIndex, fileLines, contextLines } = params;
    const result: GrepMatch = {
      file: filePath,
      line: lineIndex + 1,
      content: lineContent.trim(),
    };

    if (contextLines <= 0) {
      return result;
    }

    const contextStart = Math.max(0, lineIndex - contextLines);
    const contextEnd = Math.min(fileLines.length, lineIndex + contextLines + 1);
    result.contextBefore = fileLines.slice(contextStart, lineIndex);
    result.contextAfter = fileLines.slice(lineIndex + 1, contextEnd);

    return result;
  }

  private async readFileContent(file: TFile): Promise<string | null> {
    try {
      return await this.agent.plugin.app.vault.cachedRead(file);
    } catch {
      return null;
    }
  }

  private createSearchRegex(params: {
    pattern: string;
    isRegex: boolean;
    caseSensitive: boolean;
  }): RegExp {
    const { pattern, isRegex, caseSensitive } = params;
    const flags = caseSensitive ? 'g' : 'gi';

    if (isRegex) {
      return new RegExp(pattern, flags);
    }

    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escapedPattern, flags);
  }

  private hasGlobCharacters(path: string): boolean {
    return /[*?[\]{}]/.test(path);
  }

  private globToRegExp(globPattern: string): RegExp {
    const normalizedPattern = normalizePath(globPattern);
    let regexString = '^';

    for (let index = 0; index < normalizedPattern.length; index += 1) {
      const char = normalizedPattern[index];
      const nextChar = normalizedPattern[index + 1];
      const nextNextChar = normalizedPattern[index + 2];

      // `**/` should match zero or more path segments.
      // Example: `src/**/*` should match both `src/a.md` and `src/nested/a.md`.
      if (char === '*' && nextChar === '*' && nextNextChar === '/') {
        regexString += '(?:.*/)?';
        index += 2;
        continue;
      }

      if (char === '*' && nextChar === '*') {
        regexString += '.*';
        index += 1;
        continue;
      }

      if (char === '*') {
        regexString += '[^/]*';
        continue;
      }

      if (char === '?') {
        regexString += '[^/]';
        continue;
      }

      if ('\\.^$+|()[]{}'.includes(char)) {
        regexString += `\\${char}`;
        continue;
      }

      regexString += char;
    }

    regexString += '$';

    return new RegExp(regexString);
  }

  private async resolveFilesForGrep(params: { paths?: string[] }): Promise<TFile[]> {
    const { paths } = params;
    const plugin = this.agent.plugin;
    const allFiles = plugin.app.vault.getFiles();

    if (!paths || paths.length === 0) {
      return allFiles;
    }

    const filesByPath = new Map<string, TFile>();

    for (const rawPath of paths) {
      const normalizedPath = normalizePath(rawPath).replace(/\/$/, '');
      if (normalizedPath === '') {
        continue;
      }

      if (this.hasGlobCharacters(normalizedPath)) {
        const globRegex = this.globToRegExp(normalizedPath);
        for (const file of allFiles) {
          if (!globRegex.test(file.path)) {
            continue;
          }

          filesByPath.set(file.path, file);
        }
        continue;
      }

      const abstractFile = plugin.app.vault.getAbstractFileByPath(normalizedPath);
      if (abstractFile instanceof TFile) {
        filesByPath.set(abstractFile.path, abstractFile);
        continue;
      }

      if (abstractFile instanceof TFolder) {
        const folderPrefix = `${abstractFile.path}/`;
        for (const file of allFiles) {
          if (!file.path.startsWith(folderPrefix)) {
            continue;
          }

          filesByPath.set(file.path, file);
        }
        continue;
      }

      const matchedFile = await plugin.mediaTools.findFileByNameOrPath(normalizedPath);
      if (matchedFile) {
        filesByPath.set(matchedFile.path, matchedFile);
      }
    }

    return Array.from(filesByPath.values());
  }
}
