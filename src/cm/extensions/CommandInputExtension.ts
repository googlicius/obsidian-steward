import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
	keymap,
} from '@codemirror/view';
import { Extension, Line, Prec } from '@codemirror/state';
import {
	autocompletion,
	CompletionContext,
	CompletionResult,
	Completion,
} from '@codemirror/autocomplete';
import { capitalizeString } from 'src/utils/capitalizeString';
import { setIcon } from 'obsidian';
import { LLM_MODELS } from 'src/constants';
import { AbortService } from 'src/services/AbortService';
import { UserDefinedCommandService } from 'src/services/UserDefinedCommandService';

export interface CommandInputOptions {
	/**
	 * The callback function to call when Enter is pressed on a command line
	 */
	onEnter?: (view: EditorView) => boolean;

	/**
	 * The user-defined command service instance
	 */
	customCommandService?: UserDefinedCommandService;
}

/**
 * Determines if a command line should show a placeholder
 */
function hasCommandPlaceholder(line: Line, matchedPrefix: string): boolean {
	const command = matchedPrefix === '/ ' ? 'general' : matchedPrefix.replace('/', '');
	return command === 'general' ? line.text === matchedPrefix : line.text.trim() === matchedPrefix;
}

export function createCommandInputExtension(
	commandPrefixes: string[],
	options: CommandInputOptions = {}
): Extension {
	return [
		createInputExtension(commandPrefixes, options),
		createAutocompleteExtension(commandPrefixes, options),
		// Add keymap with high precedence
		Prec.high(
			keymap.of([
				{
					key: 'Enter',
					run: view => {
						if (options.onEnter) {
							return options.onEnter(view);
						}
						return false;
					},
				},
			])
		),
	];
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

const commandInputLineDecor = Decoration.line({ class: 'conversation-command-line' });

// Add syntax highlighting for command prefixes and toolbar for command inputs
function createInputExtension(
	commandPrefixes: string[],
	options: CommandInputOptions = {}
): Extension {
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

				// Create an extended set of prefixes including custom commands
				const extendedPrefixes = [...commandPrefixes];

				// Add custom command prefixes if available
				if (options.customCommandService) {
					const customCommands = options.customCommandService.getCommandNames();
					customCommands.forEach(cmd => {
						extendedPrefixes.push('/' + cmd);
					});
				}

				// Sort prefixes by length (longest first) to ensure we match the most specific command
				extendedPrefixes.sort((a, b) => b.length - a.length);

				// Process only the visible lines
				let pos = from;
				while (pos <= to) {
					const line = doc.lineAt(pos);
					const lineText = line.text;

					// Fast check for any command prefix
					if (lineText.startsWith('/')) {
						// Find the matching prefix (if any)
						const matchedPrefix = extendedPrefixes.find(prefix => lineText.startsWith(prefix));

						if (matchedPrefix) {
							const from = line.from + lineText.indexOf(matchedPrefix);
							const to = from + matchedPrefix.length;

							const command = matchedPrefix === '/ ' ? 'general' : matchedPrefix.replace('/', '');
							const hasPlaceholder = hasCommandPlaceholder(line, matchedPrefix);

							decorations.push(
								// Add decoration for the entire line
								commandInputLineDecor.range(line.from),

								// Add decoration for the command prefix
								Decoration.mark({
									class: `conversation-command cm-conversation-command conversation-command-${command}`,
									...(hasPlaceholder && {
										attributes: { 'has-placeholder': '1' },
									}),
								}).range(from, to)
							);
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
function createAutocompleteExtension(
	commandPrefixes: string[],
	options: CommandInputOptions = {}
): Extension {
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

				// Get built-in command options
				const builtInOptions: Completion[] = commandTypes
					.filter(cmd => cmd.prefix.startsWith(word) && cmd.prefix !== word)
					.map(cmd => ({
						label: cmd.prefix,
						type: 'keyword',
						detail: `${capitalizeString(cmd.type)} command`,
						apply: cmd.prefix + ' ',
					}));

				// Get custom command options
				const customOptions: Completion[] = [];

				// Add custom command options if available
				if (options.customCommandService) {
					const customCommands = options.customCommandService.getCommandNames();

					// Filter custom commands based on current input
					const filteredCustomCommands = customCommands.filter(
						(cmd: string) => ('/' + cmd).startsWith(word) && '/' + cmd !== word
					);

					// Add to options
					filteredCustomCommands.forEach((cmd: string) => {
						customOptions.push({
							label: '/' + cmd,
							type: 'keyword',
							detail: 'Custom command',
							apply: '/' + cmd + ' ',
						});
					});
				}

				// Combine built-in and custom options
				const completionOptions = [...builtInOptions, ...customOptions];

				if (completionOptions.length === 0) return null;

				return {
					from: line.from,
					options: completionOptions,
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
