import {
  EditorState,
  StateField,
  StateEffect,
  RangeSetBuilder,
  Text,
  RangeSet,
} from '@codemirror/state';
import { Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import { STW_SOURCE_METADATA_PATTERN, STW_SOURCE_PATTERN } from 'src/constants';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

// Define an effect to trigger recomputation of widgets
const updateWidgets = StateEffect.define();

export function createStwSourceBlocksExtension(plugin: StewardPlugin) {
  class StwSourceBlockWidget extends WidgetType {
    constructor(private content: string) {
      super();
    }

    toDOM() {
      const span = document.createElement('span');

      const metadataMatch = this.content.match(new RegExp(STW_SOURCE_METADATA_PATTERN));

      if (metadataMatch) {
        const [, sourceType, filePath, fromLine, toLine] = metadataMatch;
        const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || filePath;

        if (fromLine !== undefined && toLine !== undefined) {
          const displayFromLine = parseInt(fromLine) + 1;
          const displayToLine = parseInt(toLine) + 1;
          span.textContent = `@${fileName} (${displayFromLine}-${displayToLine})`;
        } else if (sourceType === 'folder') {
          span.textContent = `@${filePath}`;
        } else {
          span.textContent = `@${fileName}`;
        }

        span.addEventListener('click', async () => {
          try {
            if (sourceType === 'folder') return;

            const currentFile = plugin.app.workspace.getActiveFile();
            const targetFile = await plugin.mediaTools.findFileByNameOrPath(filePath);

            if (!targetFile) {
              logger.warn(`Target file not found: ${fileName}`);
              return;
            }

            if (!currentFile || currentFile.path !== filePath) {
              const mainLeaf = await plugin.getMainLeaf();
              await mainLeaf.openFile(targetFile);
              await sleep(100);
            }

            if (fromLine === undefined || toLine === undefined) return;

            const startLineNum = parseInt(fromLine);
            const endLineNum = parseInt(toLine);

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
            logger.error('Error navigating to source block:', error);
          }
        });
      } else {
        span.textContent = this.content;
      }

      span.className = 'stw-source-button';

      return span;
    }

    ignoreEvent() {
      return true;
    }

    eq(other: StwSourceBlockWidget) {
      return this.content === other.content;
    }
  }

  function findProtectedRanges(doc: Text) {
    const ranges = [];
    const text = doc.sliceString(0, doc.length);

    const pattern = new RegExp(STW_SOURCE_PATTERN, 'g');
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      ranges.push({ from, to, content: match[0] });
    }

    return ranges;
  }

  function computeDecorationsAndRanges(state: EditorState) {
    const decorationBuilder = new RangeSetBuilder<Decoration>();
    const atomicRangeBuilder = new RangeSetBuilder<Decoration>();
    const ranges = findProtectedRanges(state.doc);

    for (const { from, to, content } of ranges) {
      decorationBuilder.add(
        from,
        to,
        Decoration.replace({
          widget: new StwSourceBlockWidget(content),
          inclusive: false,
        })
      );

      atomicRangeBuilder.add(from, to, Decoration.mark({}));
    }

    return {
      decorations: decorationBuilder.finish(),
      atomicRanges: atomicRangeBuilder.finish(),
    };
  }

  const stwSourceBlocksField = StateField.define<{
    decorations: DecorationSet;
    atomicRanges: RangeSet<Decoration>;
  }>({
    create(state) {
      return computeDecorationsAndRanges(state);
    },

    update(value, tr) {
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

  return [stwSourceBlocksField];
}
