import { Editor, App } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Message } from 'ai';

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
export interface ConversationHistoryMessage extends Message {
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

export interface DocWithPath {
  path: string;
  [key: string]: unknown;
}
