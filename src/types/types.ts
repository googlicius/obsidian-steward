import { Editor, App } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Message } from 'ai';
import { SystemPromptItem } from '../utils/SystemPromptModifier';

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
  /**
   * Handler ID to group all messages issued in one handle function call
   */
  handlerId?: string;
}

/**
 * Represents a single command in a sequence
 */
export interface CommandIntent {
  commandType: string;
  query: string;
  systemPrompts?: (string | SystemPromptItem)[];
  model?: string; // Optional model to use for this command
  no_confirm?: boolean; // Skip confirmation for this command
}

export interface ContextAugmentationIntent extends CommandIntent {
  commandType: 'context_augmentation';
  retryRemaining: number;
}

export interface DocWithPath {
  path: string;
  [key: string]: unknown;
}
