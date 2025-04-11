import { EditorSelection, Extension, SelectionRange } from '@codemirror/state';
import { EditorView, keymap, KeyBinding } from '@codemirror/view';

function addCursor(direction: 'up' | 'down'): (view: EditorView) => boolean {
	return (view: EditorView): boolean => {
		const { state, dispatch } = view;
		const { selection } = state;
		const updates: SelectionRange[] = [];

		selection.ranges.forEach((range) => {
			const line = state.doc.lineAt(range.head);
			const newLine =
				direction === 'up'
					? Math.max(line.number - 1, 1)
					: Math.min(line.number + 1, state.doc.lines);

			const lineStart = state.doc.line(newLine).from;
			const lineEnd = state.doc.line(newLine).to;
			const newCursorPos = Math.min(
				lineStart + (range.head - line.from),
				lineEnd,
			);

			updates.push(EditorSelection.range(newCursorPos, newCursorPos));
		});

		dispatch(
			state.update({
				selection: EditorSelection.create([
					...selection.ranges,
					...updates,
				]),
				scrollIntoView: true,
			}),
		);
		return true;
	};
}

const bindings: KeyBinding[] = [
	{
		key: 'Shift-Alt-ArrowUp',
		run: addCursor('up'),
	},
	{
		key: 'Shift-Alt-ArrowDown',
		run: addCursor('down'),
	},
];

export const multiSelectExtension: Extension = [keymap.of(bindings)];
