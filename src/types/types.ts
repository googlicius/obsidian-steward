import { Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';

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
export interface ConversationHistoryMessage {
  role: ConversationRole;
  content: string;
}

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  lang?: string;
  command: string;
  history?: boolean;
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

/**
 * Extract only common properties from two or more types.
 */
export type Common<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Tail['length'] extends 0
    ? Head
    : Pick<Head & Common<Tail>, keyof Head & CommonKeys<Tail>>
  : never;

type CommonKeys<T extends unknown[]> = T extends [infer Head, ...infer Tail]
  ? Tail['length'] extends 0
    ? keyof Head
    : keyof Head & CommonKeys<Tail>
  : never;

type AnyFn = (...args: any[]) => any;

// Turn an overload set into a union of parameter tuples
type OverloadedParameters<T> = T extends {
  (...args: infer A1): any;
  (...args: infer A2): any;
  (...args: infer A3): any;
  (...args: infer A4): any;
  (...args: infer A5): any;
  (...args: infer A6): any;
  (...args: infer A7): any;
  (...args: infer A8): any;
  (...args: infer A9): any;
  (...args: infer A10): any;
}
  ? A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 | A10
  : T extends {
        (...args: infer A1): any;
        (...args: infer A2): any;
        (...args: infer A3): any;
        (...args: infer A4): any;
        (...args: infer A5): any;
      }
    ? A1 | A2 | A3 | A4 | A5
    : T extends AnyFn
      ? Parameters<T>
      : never;

export type FirstArgOfOverloads<T> = OverloadedParameters<T>[0];

// Overloaded function
// declare function get(opts: { resource: 'user'; id: string }): { id: string; name: string };
// declare function get(opts: { resource: 'post'; id: number }): { id: number; title: string };
// declare function get(opts: { resource: 'comment'; id: number }): { id: number; text: string };

// type GetOpts = FirstArgOfOverloads<typeof get>;
