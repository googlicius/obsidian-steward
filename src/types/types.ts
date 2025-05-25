import { Editor } from 'obsidian';
import { EditorView } from '@codemirror/view';

/**
 * Exposes the Obsidian Editor and Codemirror EditorView
 */
export type ObsidianEditor = Editor & {
	cm: EditorView;
};
