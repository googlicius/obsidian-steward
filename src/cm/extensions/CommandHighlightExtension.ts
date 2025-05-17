import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { capitalizeString } from 'src/utils/capitalizeString';

export function createCommandHighlightExtension(commandPrefixes: string[]): Extension[] {
	// Return an array of extensions: one for highlighting and one for autocomplete
	return [createHighlightExtension(commandPrefixes), createAutocompleteExtension(commandPrefixes)];
}

// Add syntax highlighting for command prefixes
function createHighlightExtension(commandPrefixes: string[]): Extension {
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
					const lineText = line.text;

					// Check for command prefixes
					for (const prefix of commandPrefixes) {
						if (lineText.startsWith(prefix)) {
							// Create a decoration for the command prefix
							const from = line.from + lineText.indexOf(prefix);
							const to = from + prefix.length;

							const command = prefix === '/ ' ? 'general' : prefix.replace('/', '');
							const hasPlaceholder =
								command === 'general' ? lineText === prefix : lineText.trim() === prefix;

							decorations.push(
								Decoration.mark({
									class: `conversation-command cm-conversation-command conversation-command-${command}`,
									...(hasPlaceholder && {
										attributes: { 'has-placeholder': '1' },
									}),
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

// Add autocomplete functionality for command prefixes
function createAutocompleteExtension(commandPrefixes: string[]): Extension {
	// Create a mapping of command prefixes to their types for easier lookup
	const commandTypes = commandPrefixes.map(prefix => {
		// Remove the slash and trim whitespace
		const type = prefix === '/ ' ? 'general' : prefix.replace('/', '');
		return { prefix, type };
	});

	return autocompletion({
		// Only activate when typing after a slash at the beginning of a line
		activateOnTyping: true,
		override: [
			(context: CompletionContext): CompletionResult | null => {
				// Get current line
				const { state, pos } = context;
				const line = state.doc.lineAt(pos);
				const lineText = line.text;

				// Only show autocomplete when cursor is at beginning of line with a slash
				if (!lineText.startsWith('/')) return null;

				// Only show when user types a character after the "/"
				if (lineText === '/ ' || lineText === '/') return null;

				// Make sure we're at the beginning of the line
				if (line.from !== pos - lineText.length && pos !== line.from + lineText.length) return null;

				// Get the current word (which starts with /)
				const word = lineText.trim();

				const options = commandTypes
					.filter(cmd => cmd.prefix.startsWith(word) && cmd.prefix !== word)
					.map(cmd => ({
						label: cmd.prefix,
						type: 'keyword',
						detail: `${capitalizeString(cmd.type)} command`,
						apply: cmd.prefix + ' ',
					}));

				if (options.length === 0) return null;

				return {
					from: line.from,
					options,
					validFor: text => {
						// If text matches an exact command, return false
						if (commandPrefixes.some(cmd => cmd === text)) return false;

						// Otherwise, validate if it starts with a slash followed by word characters
						return /^\/\w*$/.test(text);
					},
				};
			},
		],
	});
}
