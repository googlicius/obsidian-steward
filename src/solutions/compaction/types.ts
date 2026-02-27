/**
 * Compaction schema version — bump when the frontmatter layout changes
 * so stale caches are automatically invalidated.
 */
export const COMPACTION_SCHEMA_VERSION = 4;

/**
 * Compact representation of a text message (user or assistant).
 */
export interface CompactedMessageEntry {
  type: 'message';
  messageId: string;
  step?: number;
  handlerId?: string;
  role: string;
  /**
   * - original: content is the full original text
   * - excerpt: content was truncated due to length; use recall_compacted_context for full text
   * - summarized: content is an AI-generated summary
   * - deleted: message was procedural filler; content replaced with [deleted]
   */
  contentMode: 'original' | 'excerpt' | 'summarized' | 'deleted';
  content: string;
  wordCount: number;
}

/**
 * Compact representation of a tool-invocation result.
 */
export interface CompactedToolEntry {
  type: 'tool';
  messageId: string;
  toolName: string;
  metadata: Record<string, unknown>;
}

export type CompactedEntry = CompactedMessageEntry | CompactedToolEntry;

export interface CompactionData {
  version: number;
  /** Single ordered array: messages and tool results in chronological order */
  messages: CompactedEntry[];
  lastCompactedMessageId?: string;
  lastCompactedStep?: number;
  compactedAt?: number;
}

/**
 * Internal type for compactor output (orchestrator adds messageId and wraps as CompactedToolEntry).
 */
export interface CompactedToolResult {
  toolName: string;
  metadata: Record<string, unknown>;
}

export interface ToolResultCompactor {
  readonly toolName: string;
  compact(params: CompactorParams): CompactedToolResult;
}

export interface CompactorParams {
  messageId: string;
  output: unknown;
}

/**
 * Settings controlling when compaction kicks in.
 */
export interface CompactionConfig {
  enabled: boolean;
  recentWindowSize: number;
  turnThreshold: number;
  tokenBudget: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  recentWindowSize: 6,
  turnThreshold: 10,
  tokenBudget: 8000,
};
