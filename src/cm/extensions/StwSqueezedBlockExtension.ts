import {
  EditorState,
  StateField,
  StateEffect,
  RangeSetBuilder,
  Text,
  RangeSet,
} from '@codemirror/state';
import { Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { setIcon, setTooltip } from 'obsidian';
import { SMILE_CHAT_ICON_ID, STW_SQUEEZED_PATTERN } from 'src/constants';
import i18next from 'i18next';

// Define an effect to trigger recomputation of widgets
const updateWidgets = StateEffect.define();

export function createStwSqueezedBlocksExtension(plugin: StewardPlugin) {
  // Widget for rendering the {{stw-squeezed...}} block
  class StwSqueezedBlockWidget extends WidgetType {
    constructor(private content: string) {
      super();
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = 'stw-squeezed-button';

      const match = this.content.match(new RegExp(STW_SQUEEZED_PATTERN));

      if (match) {
        const [, conversationPath] = match;
        const conversationTitle = conversationPath.split('/').pop() || 'Conversation';

        // Add Steward icon directly to the span
        setIcon(span, SMILE_CHAT_ICON_ID);

        // Add conversation title directly after the icon
        span.appendChild(document.createTextNode(' ' + conversationTitle));
        setTooltip(span, i18next.t('chat.expandConversation'));

        // Handles expanding the squeezed conversation
        span.addEventListener('click', async () => {
          try {
            // Get the editor view and state
            const editorView = plugin.editor.cm;
            const { state } = editorView;

            // Find the position of this widget in the document
            const text = state.doc.toString();
            const widgetPos = text.indexOf(this.content);

            if (widgetPos >= 0) {
              // Replace the squeezed format with the conversation link
              editorView.dispatch({
                changes: {
                  from: widgetPos,
                  to: widgetPos + this.content.length,
                  insert: `![[${plugin.settings.stewardFolder}/Conversations/${conversationPath}]]\n\n/ `,
                },
              });
            }

            plugin.editor.focus();
          } catch (error) {
            logger.error('Error expanding squeezed conversation:', error);
          }
        });
      } else {
        // Fallback to original content if parsing fails
        span.textContent = this.content;
      }

      return span;
    }

    ignoreEvent() {
      // Ignore all events (prevents editing or interaction inside)
      return true;
    }

    eq(other: StwSqueezedBlockWidget) {
      return this.content === other.content;
    }
  }

  // Function to find all `stw-squeezed...` ranges in the document
  function findProtectedRanges(doc: Text) {
    const ranges = [];
    const text = doc.sliceString(0, doc.length); // Get full document as string

    // Use regex to find all {{stw-squeezed...}} patterns
    const pattern = new RegExp(STW_SQUEEZED_PATTERN, 'g');
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      ranges.push({ from, to, content: match[0] });
    }

    return ranges;
  }

  // Helper to compute the decoration set
  function computeDecorationsAndRanges(state: EditorState) {
    const decorationBuilder = new RangeSetBuilder<Decoration>();
    const atomicRangeBuilder = new RangeSetBuilder<Decoration>();
    const ranges = findProtectedRanges(state.doc);

    for (const { from, to, content } of ranges) {
      decorationBuilder.add(
        from,
        to,
        Decoration.replace({
          widget: new StwSqueezedBlockWidget(content),
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

  const stwSqueezedBlocksField = StateField.define<{
    decorations: DecorationSet;
    atomicRanges: RangeSet<Decoration>;
  }>({
    create(state) {
      return computeDecorationsAndRanges(state);
    },

    update(value, tr) {
      // Recompute on any transaction (doc change) or explicit update effect
      if (tr.docChanged || tr.effects.some(e => e.is(updateWidgets))) {
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

  return [stwSqueezedBlocksField];
}
