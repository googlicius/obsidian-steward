import { Decoration, ViewPlugin, DecorationSet } from '@codemirror/view';
import { EditorView, ViewUpdate } from '@codemirror/view';

const startMark = Decoration.mark({ class: 'cm-start-token' });
const startMarkHasPlaceHolder = Decoration.mark({
	class: 'cm-start-token',
	attributes: { 'has-placeholder': '1' },
});
const endMark = Decoration.mark({ class: 'cm-end-token' });

const highlightPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged) {
				this.decorations = this.buildDecorations(update.view);
			}
		}

		buildDecorations(view: EditorView) {
			const decorations = [];
			const doc = view.state.doc;
			const pattern = /@start|@end/g;

			// Iterate through each line in the document
			for (let i = 1; i <= doc.lines; i++) {
				const line = doc.line(i);
				const lineText = line.text;

				// Find all matches in the current line
				let match;
				while ((match = pattern.exec(lineText)) !== null) {
					// Calculate absolute position by adding line start offset to match position
					const from = line.from + match.index;
					const to = from + match[0].length;

					if (match[0] === '@start') {
						decorations.push(
							lineText.trim() === '@start'
								? startMarkHasPlaceHolder.range(from, to)
								: startMark.range(from, to),
						);
					} else {
						decorations.push(endMark.range(from, to));
					}
				}
			}

			return Decoration.set(decorations);
		}
	},
	{
		decorations: (v) => v.decorations,
	},
);

export const blockExtension = [highlightPlugin];
