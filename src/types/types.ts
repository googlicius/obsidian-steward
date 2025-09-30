import { Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Message } from 'ai';

/**
 * Exposes the Obsidian Editor and Codemirror EditorView
 */
export type ObsidianEditor = Editor & {
  cm: EditorView;
};

export type ConversationRole = 'user' | 'assistant' | 'system';

/**
 * Represents a message in the conversation history
 */
export interface ConversationHistoryMessage extends Message {
  role: ConversationRole;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  lang?: string;
  command: string;
  history?: boolean;
  type?: string;
  artifactType?: string;
}

/**
 * Represents a single command in a sequence
 */
export interface CommandIntent {
  commandType: string;
  query: string;
  systemPrompts?: string[];
  model?: string; // Optional model to use for this command
}

export interface ContextAugmentationIntent extends CommandIntent {
  commandType: 'context_augmentation';
  retryRemaining: number;
}

export interface DocWithPath {
  path: string;
  [key: string]: unknown;
}
