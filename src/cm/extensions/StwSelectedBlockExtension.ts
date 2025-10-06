import {
  EditorState,
  StateField,
  StateEffect,
  RangeSetBuilder,
  Text,
  RangeSet,
} from '@codemirror/state';
import { Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import { STW_SELECTED_METADATA_PATTERN, STW_SELECTED_PATTERN } from 'src/constants';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

// Define an effect to trigger recomputation of widgets
const updateWidgets = StateEffect.define();

export function createStwSelectedBlocksExtension(plugin: StewardPlugin) {
  // Widget for rendering the {{stw-selected...}} block
  class StwSelectedBlockWidget extends WidgetType {
    constructor(private content: string) {
      super();
    }

    toDOM() {
      const span = document.createElement('span');

      // Parse the metadata to extract note name and line numbers
      const metadataMatch = this.content.match(new RegExp(STW_SELECTED_METADATA_PATTERN));

      if (metadataMatch) {
        const [, fromLine, toLine, , filePath] = metadataMatch;
        const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';
        // Display 1-based line numbers (add 1 to 0-based stored values)
        const displayFromLine = parseInt(fromLine) + 1;
        const displayToLine = parseInt(toLine) + 1;
        span.textContent = `@${fileName} (${displayFromLine}-${displayToLine})`;

        // Handles navigation to the selected block
        span.addEventListener('click', async () => {
          try {
            // Check if the target file is different from the current file
            const currentFile = plugin.app.workspace.getActiveFile();
            const targetFile = await plugin.mediaTools.findFileByNameOrPath(filePath);

            if (!targetFile) {
              logger.warn(`Target file not found: ${fileName}`);
              return;
            }

            // If the target file is not the current file, open it first
            if (!currentFile || currentFile.path !== filePath) {
              const mainLeaf = await plugin.getMainLeaf();
              await mainLeaf.openFile(targetFile);
              await sleep(100);
            }

            // Line numbers are now stored as 0-based, so no need to subtract 1
            const startLineNum = parseInt(fromLine);
            const endLineNum = parseInt(toLine);

            // Validate line numbers are within document bounds
            const docLineCount = plugin.editor.lineCount();
            if (startLineNum < 0 || endLineNum >= docLineCount || startLineNum > endLineNum) {
              logger.warn(
                `Invalid line range: ${startLineNum + 1}-${endLineNum + 1}, document has ${docLineCount} lines`
              );
              return;
            }

            const from = { line: startLineNum, ch: 0 };
            const endLineContent = plugin.editor.getLine(endLineNum);
            const to = { line: endLineNum, ch: endLineContent ? endLineContent.length : 0 };

            plugin.editor.setSelection(from, to);
            plugin.editor.scrollIntoView({ from, to });
          } catch (error) {
            logger.error('Error navigating to selected block:', error);
          }
        });
      } else {
        // Fallback to original content if parsing fails
        span.textContent = this.content;
      }

      span.className = 'stw-selected-button';

      return span;
    }

    ignoreEvent() {
      // Ignore all events (prevents editing or interaction inside)
      return true;
    }

    eq(other: StwSelectedBlockWidget) {
      return this.content === other.content;
    }
  }

  // Function to find all `stw-selected...` ranges in the document
  function findProtectedRanges(doc: Text) {
    const ranges = [];
    const text = doc.sliceString(0, doc.length); // Get full document as string

    // Use regex to find all {{stw-selected...}} patterns
    const pattern = new RegExp(STW_SELECTED_PATTERN, 'g');
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
          widget: new StwSelectedBlockWidget(content),
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

  const stwSelectedBlocksField = StateField.define<{
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

  return [stwSelectedBlocksField];
}
