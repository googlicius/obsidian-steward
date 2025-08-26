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
import { COMMAND_PREFIXES, LLM_MODELS, TWO_SPACES_PREFIX } from 'src/constants';
import { AbortService } from 'src/services/AbortService';
import type StewardPlugin from 'src/main';

export interface CommandInputOptions {
  /**
   * The callback function to call when Enter is pressed on a command line
   */
  onEnter?: (view: EditorView) => boolean;

  /**
   * The callback function to call when Shift+Enter is pressed on a command line
   */
  onShiftEnter?: (view: EditorView) => boolean;

  /**
   * The callback function to call when typing in a command line
   */
  onTyping?: (event: KeyboardEvent, view: EditorView) => void;

  /**
   * Debounce time in milliseconds for typing
   */
  typingDebounceMs?: number;
}

/**
 * Determines if a command line should show a placeholder
 */
function hasCommandPlaceholder(line: Line, matchedPrefix: string): boolean {
  const command = matchedPrefix === '/ ' ? 'general' : matchedPrefix.replace('/', '');
  return command === 'general' ? line.text === matchedPrefix : line.text.trim() === matchedPrefix;
}

export function createCommandInputExtension(
  plugin: StewardPlugin,
  options: CommandInputOptions = {}
): Extension {
  return [
    createInputExtension(plugin, options),
    createAutocompleteExtension(plugin),
    createCommandKeymapExtension(plugin, options),
  ];
}

// Add syntax highlighting for command prefixes and toolbar for command inputs
function createInputExtension(plugin: StewardPlugin, options: CommandInputOptions = {}): Extension {
  const commandInputLineDecor = Decoration.line({ class: 'stw-input-line' });

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private typingDebounceTimeout: NodeJS.Timeout | null = null;

      constructor(private view: EditorView) {
        this.decorations = this.buildDecorations();

        // Attach event listeners
        view.dom.addEventListener('keypress', this.handleKeyPress);
        view.dom.addEventListener('paste', this.handlePaste);
      }

      destroy() {
        this.view.dom.removeEventListener('keypress', this.handleKeyPress);
        this.view.dom.removeEventListener('paste', this.handlePaste);

        // Clear any pending timeout
        if (this.typingDebounceTimeout) {
          clearTimeout(this.typingDebounceTimeout);
        }
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.buildDecorations();
        }
      }

      /**
       * Builds the decorations for the command input:
       * - Command prefix,
       * - Command line and continuation lines background.
       */
      private buildDecorations() {
        const decorations = [];
        const { state } = this.view;
        const { doc } = state;

        // Get visible range instead of processing the entire document
        const { from, to } = this.view.viewport;

        // Process only the visible lines
        let pos = from;
        while (pos <= to) {
          const line = doc.lineAt(pos);
          const lineText = line.text;

          // Fast check for any command prefix
          if (lineText.startsWith('/')) {
            const extendedPrefixes = plugin.userDefinedCommandService.buildExtendedPrefixes();
            const matchedPrefix = extendedPrefixes.find(prefix => lineText.startsWith(prefix));

            if (matchedPrefix) {
              const prefixFrom = line.from + lineText.indexOf(matchedPrefix);
              const prefixTo = prefixFrom + matchedPrefix.length;

              const command = matchedPrefix === '/ ' ? 'general' : matchedPrefix.replace('/', '');
              const hasPlaceholder = hasCommandPlaceholder(line, matchedPrefix);

              decorations.push(
                // Add decoration for the entire line
                commandInputLineDecor.range(line.from),

                // Add decoration for the command prefix
                Decoration.mark({
                  class: `stw-command-prefix stw-command-prefix-${command}`,
                  ...(hasPlaceholder && {
                    attributes: { 'has-placeholder': '1' },
                  }),
                }).range(prefixFrom, prefixTo)
              );

              // Check for continuation lines
              let nextLineNum = line.number + 1;
              while (nextLineNum <= doc.lines) {
                const nextLine = doc.line(nextLineNum);
                if (plugin.commandInputService.isContinuationLine(nextLine.text)) {
                  // Add decoration for continuation line
                  decorations.push(commandInputLineDecor.range(nextLine.from));
                  nextLineNum++;
                } else {
                  break;
                }
              }
            }
          }

          // Move to the next line
          pos = line.to + 1;
        }

        return Decoration.set(decorations);
      }

      private handleKeyPress = (event: KeyboardEvent) => {
        // Clear any existing timeout
        if (this.typingDebounceTimeout) {
          clearTimeout(this.typingDebounceTimeout);
        }

        // Set a debounced timeout to call onTyping
        this.typingDebounceTimeout = setTimeout(() => {
          if (options.onTyping) {
            // Get the current cursor position at the time of execution
            const { state } = this.view;
            const pos = state.selection.main.head;
            const line = state.doc.lineAt(pos);

            // Check if this is a command line or continuation line
            if (
              plugin.commandInputService.isCommandLine(line) ||
              plugin.commandInputService.isContinuationLine(line.text)
            ) {
              options.onTyping(event, this.view);
            }
          }
        }, options.typingDebounceMs || 0);
      };

      /**
       * Handle paste events for multi-line indentation
       */
      private handlePaste = (event: ClipboardEvent) => {
        if (!event.clipboardData) return;

        const pastedText = event.clipboardData.getData('Text');

        const pasteStart = this.view.state.selection.main.head - pastedText.length;
        const line = this.view.state.doc.lineAt(pasteStart);
        // Check if we're in a command input context
        const isInCommandContext =
          plugin.commandInputService.isCommandLine(line) ||
          plugin.commandInputService.isContinuationLine(line.text);

        if (!isInCommandContext || !pastedText) return; // Normal paste

        const pastedLines = pastedText.split('\n');

        let fullInsert = '';
        fullInsert += pastedLines[0];

        for (let index = 1; index < pastedLines.length; index++) {
          const pastedLine = pastedLines[index];
          fullInsert += plugin.commandInputService.isContinuationLine(pastedLine)
            ? '\n' + pastedLine
            : '\n' + TWO_SPACES_PREFIX + pastedLine;
        }

        event.preventDefault();
        const newCursorPos = pasteStart + fullInsert.length;
        this.view.dispatch({
          changes: { from: pasteStart, to: pasteStart + pastedText.length, insert: fullInsert },
          selection: { anchor: newCursorPos },
        });
      };
    },
    {
      decorations: v => v.decorations,
    }
  );
}

// Add autocomplete functionality for command prefixes
function createAutocompleteExtension(plugin: StewardPlugin): Extension {
  // Create a mapping of command prefixes to their types for easier lookup
  const commandTypes = COMMAND_PREFIXES.map(prefix => {
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
        const customCommands = plugin.userDefinedCommandService.getCommandNames();

        // Filter custom commands based on current input
        const filteredCustomCommands = customCommands.filter(
          (cmd: string) => ('/' + cmd).startsWith(word) && '/' + cmd !== word
        );

        // Add to options
        for (let i = 0; i < filteredCustomCommands.length; i++) {
          const cmd = filteredCustomCommands[i];

          if (commandTypes.find(cmdType => cmdType.type === cmd)) {
            continue;
          }

          customOptions.push({
            label: '/' + cmd,
            type: 'keyword',
            detail: 'Custom command',
            apply: '/' + cmd + ' ',
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
            if (COMMAND_PREFIXES.some(cmd => cmd === text)) return false;

            // Otherwise, validate if it starts with a slash followed by word characters
            return /^\/\w*$/.test(text);
          },
        };
      },
    ],
  });
}

/**
 * Add keymap with high precedence
 */
function createCommandKeymapExtension(
  plugin: StewardPlugin,
  options: CommandInputOptions = {}
): Extension {
  return Prec.high(
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
      {
        key: 'Shift-Enter',
        run: view => {
          const { state } = view;
          const { doc, selection } = state;
          const pos = selection.main.head;
          const line = doc.lineAt(pos);

          if (plugin.commandInputService.isCommandLine(line)) {
            // Get the text before and after the cursor
            const textBeforeCursor = line.text.substring(0, pos - line.from);
            const textAfterCursor = line.text.substring(pos - line.from);

            // Create a transaction to:
            // 1. Replace the current line with text before cursor
            // 2. Insert a new line with indentation + text after cursor
            view.dispatch({
              changes: [
                { from: line.from, to: line.to, insert: textBeforeCursor },
                {
                  from: line.to,
                  to: line.to,
                  insert: '\n' + TWO_SPACES_PREFIX + textAfterCursor.trim(),
                },
              ],
              selection: {
                anchor: line.from + textBeforeCursor.length + 3,
              },
            });

            // If there's a custom handler, call it
            if (options.onShiftEnter) {
              return options.onShiftEnter(view);
            }

            return true;
          }

          return false;
        },
      },
    ])
  );
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
