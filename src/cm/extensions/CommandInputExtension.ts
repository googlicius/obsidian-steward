import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { capitalizeString } from 'src/utils/capitalizeString';
import { setIcon } from 'obsidian';
import { LLM_MODELS } from 'src/constants';
import { AbortService } from 'src/services/AbortService';

export function createCommandInputExtension(commandPrefixes: string[]): Extension {
	return [createInputExtension(commandPrefixes), createAutocompleteExtension(commandPrefixes)];
}

// Toolbar widget that will be displayed below command inputs
// Note: This class is currently not used but implemented for future use
// The usage is commented out in buildDecorations method below
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class CommandToolbarWidget extends WidgetType {
	private command: string;
	private isGenerating: boolean;
	private abortService: AbortService;

	constructor(command: string) {
		super();
		this.command = command;
		this.abortService = AbortService.getInstance();
	}

	toDOM() {
		const toolbar = document.createElement('div');
		toolbar.className = 'command-toolbar';
		toolbar.dataset.command = this.command;

		// Add model selector
		const modelSelector = document.createElement('select');
		modelSelector.className = 'model-selector';

		LLM_MODELS.forEach(model => {
			const option = document.createElement('option');
			option.value = model.id;
			option.textContent = model.name;
			// if (model.id === this.modelService.getCurrentModel()) {
			// 	option.selected = true;
			// }
			modelSelector.appendChild(option);
		});

		// Add event listener to handle model changes
		modelSelector.addEventListener('change', e => {
			// const select = e.target as HTMLSelectElement;
			// this.modelService.setCurrentModel(select.value);
		});

		// Create a container for the buttons on the right
		const buttonContainer = document.createElement('div');
		buttonContainer.className = 'command-toolbar-buttons';

		// Add stop button (only visible during generation)
		const stopButton = document.createElement('button');
		stopButton.classList.add('clickable-icon');
		stopButton.textContent = 'Stop';
		setIcon(stopButton, 'x');
		stopButton.addEventListener('click', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			// Directly call abort on all operations
			this.abortService.abortAllOperations();
		});

		// Add send button
		const sendButton = document.createElement('button');
		sendButton.classList.add('clickable-icon');
		sendButton.textContent = 'Send';
		setIcon(sendButton, 'send-horizontal');
		sendButton.addEventListener('click', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			// this.modelService.sendCommand();
		});

		// Add buttons to the button container
		buttonContainer.appendChild(stopButton);
		buttonContainer.appendChild(sendButton);

		// Add elements to toolbar
		toolbar.appendChild(modelSelector);
		toolbar.appendChild(buttonContainer);
		return toolbar;
	}

	eq(other: CommandToolbarWidget) {
		return this.command === other.command && this.isGenerating === other.isGenerating;
	}

	ignoreEvent() {
		return false; // Allow events to be handled by the widget
	}
}

// Add syntax highlighting for command prefixes and toolbar for command inputs
function createInputExtension(commandPrefixes: string[]): Extension {
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

				// Get visible range instead of processing the entire document
				const { from, to } = view.viewport;

				// Process only the visible lines
				let pos = from;
				while (pos <= to) {
					const line = doc.lineAt(pos);
					const lineText = line.text;

					// Fast check for any command prefix
					if (lineText.startsWith('/')) {
						// Find the matching prefix (if any)
						const matchedPrefix = commandPrefixes.find(prefix => lineText.startsWith(prefix));

						if (matchedPrefix) {
							const from = line.from + lineText.indexOf(matchedPrefix);
							const to = from + matchedPrefix.length;

							const command = matchedPrefix === '/ ' ? 'general' : matchedPrefix.replace('/', '');
							const hasPlaceholder =
								command === 'general'
									? lineText === matchedPrefix
									: lineText.trim() === matchedPrefix;

							// Add decoration for the command prefix
							decorations.push(
								Decoration.mark({
									class: `conversation-command cm-conversation-command conversation-command-${command}`,
									...(hasPlaceholder && {
										attributes: { 'has-placeholder': '1' },
									}),
								}).range(from, to)
							);

							// Add toolbar widget at the end of the line
							// decorations.push(
							// 	Decoration.widget({
							// 		widget: new CommandToolbarWidget(command),
							// 		side: 1,
							// 	}).range(line.to)
							// );
						}
					}

					// Move to the next line
					pos = line.to + 1;
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
		icons: false,
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
