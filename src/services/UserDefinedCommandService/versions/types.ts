/**
 * Shared types used across all versions
 */
export interface CommandStep {
  name?: string;
  system_prompt?: string[];
  query: string;
  model?: string;
  no_confirm?: boolean;
}

export interface TriggerCondition {
  // Event types to watch
  events: ('create' | 'modify' | 'delete')[];

  // Folder path(s) to watch (optional)
  folders?: string[];

  // Pattern matching (all conditions must be met)
  // Keys can be 'tags' for tags, 'content' for regex, or any frontmatter property name
  patterns?: Record<string, string | string[]>;
}

/**
 * Normalized user-defined command format used internally
 * This is the common format after version-specific normalization
 */
export interface NormalizedUserDefinedCommand {
  command_name: string;
  query_required?: boolean;
  steps: CommandStep[];
  file_path: string;
  model?: string;
  system_prompt?: string[];
  triggers?: TriggerCondition[];
}

/**
 * Interface that all version implementations must follow
 */
export interface IVersionedUserDefinedCommand {
  /**
   * Get the version number
   */
  getVersion(): number;

  /**
   * Normalized command in the internal format
   */
  readonly normalized: NormalizedUserDefinedCommand;

  /**
   * Check if the command should be hidden from command lists
   */
  isHidden(): boolean;

  /**
   * Get the raw parsed data (for backward compatibility)
   */
  getRaw(): unknown;
}
