import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  keymap,
  WidgetType,
} from '@codemirror/view';
import {
  Extension,
  Line,
  Prec,
  EditorState,
  StateField,
  RangeSetBuilder,
  Text,
  RangeSet,
} from '@codemirror/state';
import { SELECTED_MODEL_PATTERN, TWO_SPACES_PREFIX } from 'src/constants';
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
    createCommandKeymapExtension(plugin, options),
    createSelectedModelExtension(),
  ];
}

// Add syntax highlighting for command prefixes and toolbar for command inputs
function createInputExtension(plugin: StewardPlugin, options: CommandInputOptions = {}): Extension {
  const commandInputLineDecor = Decoration.line({ class: 'stw-input-line' });

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private typingDebounceTimeout: number | null = null;

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
        this.typingDebounceTimeout = window.setTimeout(() => {
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

/**
 * Extension to display selected model as a widget
 * Pattern: `m:<provider>:<modelId>` or `model:<provider>:<modelId>`
 * Display as `<modelId>`
 */
export function createSelectedModelExtension(): Extension {
  // Widget for rendering the model selector
  class SelectedModelWidget extends WidgetType {
    constructor(
      private selectorPrefix: string,
      private provider: string,
      private modelId: string
    ) {
      super();
    }

    toDOM() {
      const span = document.createElement('span');
      span.textContent = this.modelId;
      span.className = 'stw-selected-model';
      span.title = `${this.provider}:${this.modelId}`;
      return span;
    }

    ignoreEvent() {
      return true;
    }

    eq(other: SelectedModelWidget) {
      return (
        this.selectorPrefix === other.selectorPrefix &&
        this.provider === other.provider &&
        this.modelId === other.modelId
      );
    }
  }

  // Function to find all model selector patterns in the document
  function findModelSelectorRanges(doc: Text) {
    const ranges = [];
    const text = doc.sliceString(0, doc.length);

    const regex = new RegExp(SELECTED_MODEL_PATTERN, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      const selectorPrefix = match[1].toLowerCase();
      const provider = match[2];
      const modelId = match[3];

      ranges.push({ from, to, selectorPrefix, provider, modelId });
    }

    return ranges;
  }

  // Helper to compute the decoration set
  function computeDecorationsAndRanges(state: EditorState) {
    const decorationBuilder = new RangeSetBuilder<Decoration>();
    const atomicRangeBuilder = new RangeSetBuilder<Decoration>();
    const ranges = findModelSelectorRanges(state.doc);

    for (const { from, to, selectorPrefix, provider, modelId } of ranges) {
      decorationBuilder.add(
        from,
        to,
        Decoration.replace({
          widget: new SelectedModelWidget(selectorPrefix, provider, modelId),
          inclusive: false,
        })
      );

      // Add the same range to the atomic ranges builder
      atomicRangeBuilder.add(from, to, Decoration.mark({}));
    }

    return {
      decorations: decorationBuilder.finish(),
      atomicRanges: atomicRangeBuilder.finish(),
    };
  }

  const selectedModelField = StateField.define<{
    decorations: DecorationSet;
    atomicRanges: RangeSet<Decoration>;
  }>({
    create(state) {
      return computeDecorationsAndRanges(state);
    },

    update(value, tr) {
      // Recompute on any transaction (doc change)
      if (tr.docChanged) {
        return computeDecorationsAndRanges(tr.state);
      }

      return {
        decorations: value.decorations.map(tr.changes),
        atomicRanges: value.atomicRanges.map(tr.changes),
      };
    },

    provide(field) {
      return [
        EditorView.decorations.from(field, value => value.decorations),
        EditorView.atomicRanges.from(field, value => () => value.atomicRanges),
      ];
    },
  });

  return [selectedModelField];
}
