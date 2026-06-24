import { Editor, App } from 'obsidian';
import { EditorView } from '@codemirror/view';
import type { UIMessage } from 'ai';

/**
 * Exposes the Obsidian Editor and Codemirror EditorView
 */
export type ObsidianEditor = Editor & {
  cm: EditorView;
};

/**
 * Extended App type that includes internal plugins access
 */
export interface ExtendedApp extends App {
  internalPlugins?: {
    getPluginById(id: string): {
      enabled: boolean;
    } | null;
  };
}

export type ConversationRole = 'user' | 'assistant' | 'system';

/**
 * Represents a message in the conversation history
 */
export interface ConversationHistoryMessage extends UIMessage {
  role: ConversationRole;
  handlerId?: string;
  step?: number;
  reasoning_content?: string;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  lang?: string;
  intent: string;
  history?: boolean;
  /** When true, history extraction starts from this message (drops everything before it). */
  anchor?: boolean;
  type?: string;
  artifactType?: string;
  /**
   * Handler ID to group all messages issued in one handle function call
   */
  handlerId?: string;
  /**
   * Step number for grouping messages in one invocation or one AI function call.
   */
  step?: number;
}

export interface ExtractedConversationMessages {
  messages: ConversationMessage[];
  /** Indexes of messages with intent 'compacted', in ascending chronological order */
  compactedIndexes: number[];
  /** Indexes of messages with anchor === true, in ascending chronological order */
  anchorIndexes: number[];
}

export interface DocWithPath {
  path: string;
  [key: string]: unknown;
}
