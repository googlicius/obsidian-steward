import { EditorState, StateField, StateEffect, RangeSetBuilder, RangeSet } from '@codemirror/state';
import { Decoration, WidgetType, EditorView, DecorationSet } from '@codemirror/view';
import {
  STW_SOURCE_AT_PATH_PATTERN,
  STW_SOURCE_METADATA_PATTERN,
  STW_SOURCE_PATTERN,
} from 'src/constants';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { decodePath } from 'src/utils/pathEncoding';
import { completionStatus } from '@codemirror/autocomplete';

// Define an effect to trigger recomputation of widgets
const updateWidgets = StateEffect.define();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type StwSourceRefFields = {
  sourceType: 'file' | 'folder' | 'selected';
  filePath: string;
  fromLine: string | undefined;
  toLine: string | undefined;
  displayText: string;
};

/**
 * Normalizes braced {{stw-source ...}} and short @encoded/path into the same fields.
 * For the short form, the display is the decoded path as-is (trailing `/` marks
 * folders, otherwise the file extension is visible). For the braced form, the
 * display is the basename plus an optional line range.
 */
function buildSourceRefFields(content: string): StwSourceRefFields | null {
  const meta = content.match(new RegExp('^' + STW_SOURCE_METADATA_PATTERN + '$'));
  if (meta) {
    const sourceType = meta[1] as StwSourceRefFields['sourceType'];
    const filePath = meta[2];
    const fromLine = meta[3];
    const toLine = meta[4];
    const baseName = filePath.split('/').pop() || filePath;
    const displayText =
      fromLine !== undefined && toLine !== undefined
        ? `${baseName} (${parseInt(fromLine, 10) + 1}-${parseInt(toLine, 10) + 1})`
        : baseName;
    return { sourceType, filePath, fromLine, toLine, displayText };
  }

  const at = content.match(new RegExp('^' + STW_SOURCE_AT_PATH_PATTERN + '$'));
  if (!at || at[1] === undefined) {
    return null;
  }

  const decodedPath = decodePath(at[1]);
  const isFolder = decodedPath.endsWith('/');
  return {
    sourceType: isFolder ? 'folder' : 'file',
    filePath: isFolder ? decodedPath.slice(0, -1) : decodedPath,
    fromLine: undefined,
    toLine: undefined,
    displayText: decodedPath,
  };
}

export function createStwSourceBlocksExtension(plugin: StewardPlugin) {
  class StwSourceBlockWidget extends WidgetType {
    constructor(private content: string) {
      super();
    }

    toDOM() {
      const span = document.createElement('span');
      span.className = 'stw-source-button';

      const fields = buildSourceRefFields(this.content);
      if (!fields) {
        span.textContent = this.content;
        return span;
      }

      span.textContent = fields.displayText;

      if (fields.sourceType === 'folder') {
        return span;
      }

      const { filePath, fromLine, toLine, displayText } = fields;

      span.addEventListener('click', async () => {
        try {
          const currentFile = plugin.app.workspace.getActiveFile();
          const targetFile = await plugin.mediaTools.findFileByNameOrPath(filePath);

          if (!targetFile) {
            logger.warn(`Target file not found: ${displayText}`);
            return;
          }

          if (!currentFile || currentFile.path !== filePath) {
            const mainLeaf = await plugin.getMainLeaf();
            await mainLeaf.openFile(targetFile);
            await sleep(100);
          }

          if (fromLine === undefined || toLine === undefined) {
            return;
          }

          const startLineNum = parseInt(fromLine, 10);
          const endLineNum = parseInt(toLine, 10);
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

      return span;
    }

    ignoreEvent() {
      return true;
    }

    eq(other: StwSourceBlockWidget) {
      return this.content === other.content;
    }
  }

  function findProtectedRanges(state: EditorState) {
    type Range = { from: number; to: number; content: string };
    const doc = state.doc;
    const text = doc.sliceString(0, doc.length);
    const bracedRanges: Range[] = [];
    const bracedPattern = new RegExp(STW_SOURCE_PATTERN, 'g');
    let match: RegExpExecArray | null;
    while ((match = bracedPattern.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      bracedRanges.push({ from, to, content: match[0] });
    }

    const atRanges: Range[] = [];
    const atPattern = new RegExp(STW_SOURCE_AT_PATH_PATTERN, 'g');
    while ((match = atPattern.exec(text)) !== null) {
      const from = match.index;
      const to = from + match[0].length;
      // Match @refs only at token boundaries (line start / whitespace).
      if (from > 0) {
        const prev = text[from - 1];
        if (prev !== undefined && !/\s/.test(prev)) {
          continue;
        }
      }
      // Avoid decorating @refs that are already inside {{stw-source ...}} ranges.
      if (bracedRanges.some(b => from < b.to && to > b.from)) {
        continue;
      }
      const line = doc.lineAt(from);
      if (!plugin.commandInputService.getInputPrefix(line, doc)) {
        continue;
      }
      atRanges.push({ from, to, content: match[0] });
    }

    const ranges = bracedRanges.concat(atRanges);
    ranges.sort((a, b) => a.from - b.from);
    return ranges;
  }

  function computeDecorationsAndRanges(state: EditorState) {
    const decorationBuilder = new RangeSetBuilder<Decoration>();
    const atomicRangeBuilder = new RangeSetBuilder<Decoration>();
    const ranges = findProtectedRanges(state);

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
      if (
        !completionStatus(tr.state) &&
        (tr.docChanged || tr.effects.some(e => e.is(updateWidgets)))
      ) {
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
