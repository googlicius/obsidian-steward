import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  keymap,
} from '@codemirror/view';
import { Extension, Line, Prec } from '@codemirror/state';
import { TWO_SPACES_PREFIX } from 'src/constants';
import type StewardPlugin from 'src/main';
import i18next from 'src/i18n';
import { Events, type ModelChangedPayload } from 'src/types/events';
import { completionStatus } from '@codemirror/autocomplete';
import { cliSessionDecorationRefresh } from 'src/services/CommandInputService';

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
    createArrowDownNewLineExtension(plugin),
    createInputExtension(plugin, options),
    createCommandKeymapExtension(plugin, options),
    createPasteHandlerExtension(plugin),
  ];
}

// Add syntax highlighting for command prefixes and toolbar for command inputs
function createInputExtension(plugin: StewardPlugin, options: CommandInputOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private typingDebounceTimeout: number | null = null;
      private decorationBuildRequestId = 0;

      constructor(private view: EditorView) {
        this.decorations = Decoration.none;
        void this.buildDecorations();

        // Attach event listeners
        view.dom.addEventListener('keypress', this.handleKeyPress);
        view.dom.addEventListener(Events.MODEL_CHANGED, this.handleModelChanged);
      }

      destroy() {
        this.view.dom.removeEventListener('keypress', this.handleKeyPress);
        this.view.dom.removeEventListener(Events.MODEL_CHANGED, this.handleModelChanged);

        // Clear any pending timeout
        if (this.typingDebounceTimeout) {
          clearTimeout(this.typingDebounceTimeout);
        }
      }

      update(update: ViewUpdate) {
        const cliSessionChanged = update.transactions.some(
          tr => tr.annotation(cliSessionDecorationRefresh) === true
        );
        if (update.docChanged || update.viewportChanged || cliSessionChanged) {
          void this.buildDecorations();
        }
      }

      /**
       * Builds the decorations for the command input:
       * - Command prefix,
       * - Command line and continuation lines background.
       */
      private async buildDecorations(): Promise<void> {
        const requestId = ++this.decorationBuildRequestId;
        const decorations = [];
        let extendedPrefixes: string[] | null = null;
        /** Cached model display label for the active conversation (fetched at most once per build). */
        let cachedConversationModelLabel: string | undefined;
        // Track if we fetched data asynchronously (e.g., model label from conversation title)
        // so we can trigger a view update after decorations are set
        let isAsync = false;

        // Get visible range instead of processing the entire document
        const { from, to } = this.view.viewport;

        // Process only the visible lines
        let pos = from;
        while (pos <= to) {
          const line = this.view.state.doc.lineAt(pos);
          const lineText = line.text;

          // Fast check for any command prefix
          if (!lineText.startsWith('/')) {
            pos = line.to + 1;
            continue;
          }

          if (!extendedPrefixes) {
            extendedPrefixes = plugin.userDefinedCommandService.buildExtendedPrefixes();
          }

          /** Prefix with slash "/" */
          const matchedPrefix = extendedPrefixes.find(prefix => lineText.startsWith(prefix));

          if (matchedPrefix) {
            const prefixFrom = line.from + lineText.indexOf(matchedPrefix);
            const prefixTo = prefixFrom + matchedPrefix.length;
            const conversationTitle = plugin.findConversationTitleAbove(this.view, line.number);

            const hasShellSession =
              !!conversationTitle &&
              plugin.cliSessionService.getSession(conversationTitle) !== undefined;
            const isShellPrefix = matchedPrefix === '/>';

            let lineCaption: string | undefined;
            if (hasShellSession || isShellPrefix) {
              lineCaption = hasShellSession
                ? i18next.t('cli.inputLineCaptionShellActive')
                : i18next.t('cli.inputLineCaptionShellPrefix');
            } else if (conversationTitle) {
              if (cachedConversationModelLabel === undefined) {
                cachedConversationModelLabel = await plugin.getCurrentConversationModelLabel({
                  conversationTitle,
                  forceRefresh: true,
                });
                isAsync = true;
              }
              lineCaption = cachedConversationModelLabel;
            } else {
              const commandName = matchedPrefix.replace('/', '').trim();
              let commandModel = '';

              if (plugin.userDefinedCommandService.hasCommand(commandName)) {
                commandModel = plugin.userDefinedCommandService.userDefinedCommands.get(commandName)
                  ?.normalized.model as string;
              }

              if (!commandModel) {
                commandModel = plugin.settings.llm.chat.model;
              }

              lineCaption = plugin.llmService.formatModelLabel(commandModel);
            }

            const commandInputLineDecor = Decoration.line({
              class: 'stw-input-line',
              attributes: {
                ...(lineCaption && {
                  'data-stw-input-caption': lineCaption,
                }),
              },
            });

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
            while (nextLineNum <= this.view.state.doc.lines) {
              const nextLine = this.view.state.doc.line(nextLineNum);
              if (plugin.commandInputService.isContinuationLine(nextLine.text)) {
                // Add decoration for continuation line
                decorations.push(commandInputLineDecor.range(nextLine.from));
                nextLineNum++;
              } else {
                break;
              }
            }
          }

          // Move to the next line
          pos = line.to + 1;
        }

        if (requestId !== this.decorationBuildRequestId) {
          return;
        }

        this.decorations = Decoration.set(decorations);

        // If we performed async operations, dispatch an empty transaction to trigger
        // a view update and re-render the decorations with the fetched data
        if (isAsync) {
          setTimeout(() => {
            this.view.dispatch({});
          });
        }
      }

      private handleModelChanged = (event: Event) => {
        const modelChangedEvent = event as CustomEvent<ModelChangedPayload>;
        if (!modelChangedEvent.detail.modelId) return;
        void this.buildDecorations();
      };

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
    },
    {
      decorations: v => v.decorations,
    }
  );
}

/**
 * Creates an extension to handle paste events for multi-line indentation
 */
function createPasteHandlerExtension(plugin: StewardPlugin): Extension {
  return Prec.high(
    EditorView.domEventHandlers({
      paste(event: ClipboardEvent, view: EditorView): boolean {
        // This handler is called BEFORE CodeMirror processes the paste

        if (!event.clipboardData) {
          return false; // Let default behavior happen
        }

        const pastedText = event.clipboardData.getData('Text');
        const normalizedPastedText = pastedText.replace(/\r/g, '');
        const offset = pastedText.length - normalizedPastedText.length;

        if (!pastedText) {
          return false; // Let default behavior happen
        }

        const { from, to } = view.state.selection.main;

        // Get the line at the paste position (before paste happens)
        const line = view.state.doc.lineAt(from);

        // Check if we're in a command input context
        const inputPrefix = plugin.commandInputService.getInputPrefix(line, view.state.doc);

        if (!inputPrefix) {
          return false; // Let default paste behavior happen
        }

        // Process pasted lines and add TWO_SPACES_PREFIX to continuation lines
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
        const newCursorPos = from + fullInsert.length;

        view.dispatch({
          changes: {
            from,
            to,
            insert: fullInsert,
          },
          selection: { anchor: newCursorPos - offset },
        });

        return true; // Event handled
      },
    })
  );
}

/**
 * DOM keydown handler so "exit" from the last line of a command block works reliably.
 * Obsidian often handles ArrowDown before CodeMirror keymap runs. Use a high-precedence
 */
function createArrowDownNewLineExtension(plugin: StewardPlugin): Extension {
  return Prec.high(
    EditorView.domEventHandlers({
      keydown(event: KeyboardEvent, view: EditorView): boolean {
        if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        if (event.shiftKey) return false;

        if (event.isComposing) return false;

        // While completions are open or loading, skip
        if (completionStatus(view.state)) return false;

        const { state } = view;
        const sel = state.selection.main;
        if (!sel.empty) return false;

        const doc = state.doc;
        const line = doc.lineAt(sel.head);

        if (line.number !== doc.lines) return false;

        if (!plugin.commandInputService.getInputPrefix(line, doc)) return false;

        event.preventDefault();
        view.dispatch({
          changes: { from: line.to, to: line.to, insert: '\n' },
          selection: { anchor: line.to + 1 },
          scrollIntoView: true,
        });
        return true;
      },
    })
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
        key: 'Ctrl-c',
        run: view => {
          const selection = view.state.selection.main;
          if (!selection.empty) {
            return false;
          }

          const doc = view.state.doc;
          const line = doc.lineAt(selection.head);
          const inputPrefix = plugin.commandInputService.getInputPrefix(line, doc);
          if (!inputPrefix) {
            return false;
          }

          const conversationTitle = plugin.findConversationTitleAbove(view, line.number);
          if (!conversationTitle) {
            return false;
          }

          const aborted = plugin.abortService.abortConversation(conversationTitle);
          const session = plugin.cliSessionService.getSession(conversationTitle);
          if (session) {
            void plugin.cliSessionService.interruptSession(session);
          }

          return aborted > 0 || Boolean(session);
        },
      },
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
        key: 'Backspace',
        run: view => {
          const { state } = view;
          const sel = state.selection.main;
          if (!sel.empty) return false;

          const pos = sel.head;
          const doc = state.doc;
          const line = doc.lineAt(pos);

          const linePrefix = plugin.commandInputService.getInputPrefix(line, doc);
          if (!linePrefix) return false;
          if (plugin.commandInputService.isCommandLine(line)) return false;

          if (line.number < 2) return false;

          const rel = pos - line.from;
          const tabCount = plugin.commandInputService.getLeadingTabCount(line.text);
          const prefixEnd = tabCount + TWO_SPACES_PREFIX.length;

          // Leading tabs + mandatory two spaces: never delete those spaces first — remove a tab
          // so the line stays a valid continuation line (Obsidian often strips both spaces at once).
          if (tabCount > 0 && rel > tabCount && rel <= prefixEnd) {
            const tabRemoveFrom = line.from + tabCount - 1;
            view.dispatch({
              changes: { from: tabRemoveFrom, to: tabRemoveFrom + 1, insert: '' },
              selection: { anchor: pos - 1 },
            });
            return true;
          }

          // Merge with previous line only when the line has no leading tabs (prefix is just two spaces).
          if (tabCount !== 0 || rel > TWO_SPACES_PREFIX.length) return false;

          const prevLine = doc.line(line.number - 1);
          const mergeStart = Math.max(rel, TWO_SPACES_PREFIX.length);
          const inserted = line.text.slice(mergeStart);

          view.dispatch({
            changes: { from: prevLine.to, to: line.to, insert: inserted },
            selection: { anchor: prevLine.to },
          });

          return true;
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
