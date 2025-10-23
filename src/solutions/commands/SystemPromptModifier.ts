/**
 * Represents a system prompt modification operation
 */
export interface SystemPromptModification {
  mode: 'modify' | 'remove' | 'add';
  pattern?: string;
  replacement?: string;
  content?: string;
  matchType?: 'exact' | 'partial' | 'regex';
}

/**
 * System prompt item can be either a string (old format) or a modification object (new format)
 */
export type SystemPromptItem = string | SystemPromptModification;

/**
 * Utility class to apply modifications to system prompts
 */
export class SystemPromptModifier {
  private modificationOperations: SystemPromptModification[];
  private stringAdditions: string[];

  constructor(modifications: (string | SystemPromptItem)[] | undefined) {
    this.modificationOperations = [];
    this.stringAdditions = [];

    if (!modifications) {
      return;
    }

    // Separate modification operations from string additions
    for (const mod of modifications) {
      if (typeof mod === 'string') {
        this.stringAdditions.push(mod);
      } else {
        this.modificationOperations.push(mod);
      }
    }
  }

  /**
   * Apply the stored modifications to a base system prompt
   * Note: This only applies modification operations (remove, modify, add)
   * String additions should be retrieved separately via getStringAdditions()
   * @param basePrompt The base system prompt to modify
   * @returns The modified system prompt (without string additions)
   */
  public apply(basePrompt: string): string {
    if (this.modificationOperations.length === 0) {
      return basePrompt;
    }

    let result = basePrompt;

    // Process modification operations only
    for (const mod of this.modificationOperations) {
      result = this.applyModification(result, mod);
    }

    return result;
  }

  /**
   * Get the additional system prompts (string format)
   * These are string-based system prompt additions that should be handled separately
   * @returns Array of additional system prompt strings
   */
  public getAdditionalSystemPrompts(): string[] {
    return [...this.stringAdditions];
  }

  /**
   * Apply a single modification operation to the prompt
   */
  private applyModification(prompt: string, mod: SystemPromptModification): string {
    switch (mod.mode) {
      case 'remove':
        return this.removePattern(prompt, mod);
      case 'modify':
        return this.modifyPattern(prompt, mod);
      case 'add':
        return this.addContent(prompt, mod);
      default:
        return prompt;
    }
  }

  /**
   * Remove lines matching the pattern
   * Supports multi-line patterns by splitting them and removing all matching lines
   */
  private removePattern(prompt: string, mod: SystemPromptModification): string {
    if (!mod.pattern) {
      return prompt;
    }
    const pattern = mod.pattern;
    const matchType = mod.matchType || 'partial';

    // Check if pattern contains newlines (multi-line pattern)
    const patternLines = pattern.includes('\n')
      ? pattern.split('\n').filter(p => p.length > 0) // Filter out empty strings
      : [pattern];

    const lines = prompt.split('\n');

    // Filter out lines that match any of the pattern lines
    const filteredLines = lines.filter(line => {
      // Check if this line matches any of the pattern lines
      return !patternLines.some(patternLine => this.matchesPattern(line, patternLine, matchType));
    });

    return filteredLines.join('\n');
  }

  /**
   * Modify lines matching the pattern with replacement
   */
  private modifyPattern(prompt: string, mod: SystemPromptModification): string {
    if (!mod.pattern || !mod.replacement) {
      return prompt;
    }

    const { pattern, replacement } = mod;
    const matchType = mod.matchType || 'partial';

    const lines = prompt.split('\n');
    const modifiedLines = lines.map(line => {
      if (this.matchesPattern(line, pattern, matchType)) {
        return this.replaceInLine(line, pattern, replacement, matchType);
      }
      return line;
    });

    return modifiedLines.join('\n');
  }

  /**
   * Add content to the prompt
   */
  private addContent(prompt: string, mod: SystemPromptModification): string {
    if (!mod.content) {
      return prompt;
    }

    // If pattern is provided, insert relative to that pattern
    if (mod.pattern) {
      return this.insertRelativeToPattern(prompt, mod);
    }

    // Otherwise, append to the end
    return prompt + '\n' + mod.content;
  }

  /**
   * Insert content relative to a pattern
   */
  private insertRelativeToPattern(prompt: string, mod: SystemPromptModification): string {
    if (!mod.pattern || !mod.content) {
      return prompt;
    }

    const lines = prompt.split('\n');
    const matchType = mod.matchType || 'partial';
    const result: string[] = [];

    for (const line of lines) {
      if (this.matchesPattern(line, mod.pattern, matchType)) {
        // Insert before or after based on content
        // Default is after
        result.push(line);
        result.push(mod.content);
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
   * Check if a line matches the pattern based on match type
   */
  private matchesPattern(
    line: string,
    pattern: string,
    matchType: 'exact' | 'partial' | 'regex'
  ): boolean {
    switch (matchType) {
      case 'exact':
        return line === pattern;
      case 'partial':
        return line.toLowerCase().includes(pattern.toLowerCase());
      case 'regex':
        try {
          const regex = new RegExp(pattern);
          return regex.test(line);
        } catch (e) {
          // If regex is invalid, fall back to partial match
          return line.includes(pattern);
        }
      default:
        return false;
    }
  }

  /**
   * Replace pattern in a line based on match type
   */
  private replaceInLine(
    line: string,
    pattern: string,
    replacement: string,
    matchType: 'exact' | 'partial' | 'regex'
  ): string {
    switch (matchType) {
      case 'exact':
        return line === pattern ? replacement : line;
      case 'partial':
        return line.replace(pattern, replacement);
      case 'regex':
        try {
          const regex = new RegExp(pattern, 'g');
          return line.replace(regex, replacement);
        } catch (e) {
          // If regex is invalid, fall back to partial replace
          return line.replace(pattern, replacement);
        }
      default:
        return line;
    }
  }

  /**
   * Static factory method to create a modifier with modifications
   * @param modifications The modifications to apply
   * @returns A new SystemPromptModifier instance
   */
  static withModifications(
    modifications: (string | SystemPromptItem)[] | undefined
  ): SystemPromptModifier {
    return new SystemPromptModifier(modifications);
  }
}
