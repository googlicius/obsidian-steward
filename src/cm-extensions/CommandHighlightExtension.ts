import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';

export function createCommandHighlightExtension(commandPrefixes: string[]): Extension {
	// Add syntax highlighting for command prefixes
	return ViewPlugin.fromClass(
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
				const { state } = view;
				const { doc } = state;

				// Iterate through each line in the document
				for (let i = 1; i <= doc.lines; i++) {
					const line = doc.line(i);
					const lineText = line.text.trim();

					// Check for command prefixes
					for (const prefix of commandPrefixes) {
						if (lineText.startsWith(prefix)) {
							// Create a decoration for the command prefix
							const from = line.from + lineText.indexOf(prefix);
							const to = from + prefix.length;
							const commandType = prefix.substring(1); // Remove the / from the prefix

							decorations.push(
								Decoration.mark({
									class: `conversation-command cm-conversation-command-${commandType}`,
								}).range(from, to)
							);
							break;
						}
					}
				}

				return Decoration.set(decorations);
			}
		},
		{
			decorations: v => v.decorations,
		}
	);
}
