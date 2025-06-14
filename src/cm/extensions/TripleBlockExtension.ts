import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { MarkdownPostProcessor, MarkdownPostProcessorContext } from 'obsidian';

// Define the decoration types for triple-quoted blocks
const tripleBlockStart = Decoration.line({ class: 'st-triple-block st-triple-block-start' });
const tripleBlockEnd = Decoration.line({ class: 'st-triple-block st-triple-block-end' });
const tripleBlockLine = Decoration.line({ class: 'st-triple-block' });

// Define a type for block ranges
interface BlockRange {
  start: number;
  end: number;
}

// Extension to highlight triple-quoted blocks
export function createTripleBlockExtension(): Extension {
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
        const { state } = view;
        const { doc } = state;
        const decorations = [];

        // First pass: Find all valid block pairs
        const validBlocks: BlockRange[] = [];
        const blockStack: number[] = [];

        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const lineText = line.text.trim();

          if (lineText === '"""') {
            if (blockStack.length === 0) {
              // Start a new block
              blockStack.push(i);
            } else {
              // Close a block
              const startLine = blockStack.pop();
              if (startLine !== undefined) {
                validBlocks.push({ start: startLine, end: i });
              }
            }
          }
        }

        // Second pass: Apply decorations only to valid blocks
        for (let i = 1; i <= doc.lines; i++) {
          const line = doc.line(i);
          const lineText = line.text.trim();

          // Check if this line is part of a valid block
          for (const block of validBlocks) {
            if (i === block.start) {
              // Start of block
              if (lineText === '"""') {
                decorations.push(tripleBlockStart.range(line.from));
              }
            } else if (i === block.end) {
              // End of block
              if (lineText === '"""') {
                decorations.push(tripleBlockEnd.range(line.from));
              }
            } else if (i > block.start && i < block.end) {
              // Inside a block
              decorations.push(tripleBlockLine.range(line.from));
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

/**
 * Creates a markdown post processor for triple-quoted blocks in reading view
 *
 * This handles the complexities of how Obsidian renders paragraphs in reading view,
 * where multiple lines might be grouped into a single <p> element.
 */
export function createTripleBlockPostProcessor(): MarkdownPostProcessor {
  // We need to track block state globally since post processor
  // may be called multiple times on different sections
  let inBlock = false;

  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    // el is the element being processed, typically a paragraph in reading view
    const text = el.textContent?.trim() || '';

    // Check if this element contains a triple quote marker
    if (text.includes('"""')) {
      el.classList.add('st-triple-block');

      // If the element consists of only """, possibly with whitespace
      if (text === '"""' || /^\s*"""\s*$/.test(text)) {
        if (!inBlock) {
          el.classList.add('st-triple-block-start');
          inBlock = true;
        } else {
          el.classList.add('st-triple-block-end');
          inBlock = false;
        }
        el.textContent = '';
      } else {
        // Check if this element starts with triple quotes (ignoring whitespace)
        if (/^\s*"""/.test(text)) {
          el.classList.add('st-triple-block-start');
          inBlock = true;
          removeTripleQuotes(el, 'start');
        }

        // Check if this element ends with triple quotes (ignoring whitespace)
        if (/"""\s*$/.test(text)) {
          el.classList.add('st-triple-block-end');
          inBlock = false;
          removeTripleQuotes(el, 'end');
        }
      }
    } else if (inBlock) {
      // This element is inside a block but doesn't contain triple quotes
      el.classList.add('st-triple-block');
    }
  };
}

function removeTripleQuotes(el: HTMLElement, position: 'start' | 'end') {
  const p = el.querySelector('p');
  if (!p) return;

  if (position === 'start') {
    const firstChild = p.childNodes[0];
    const secondChild = p.childNodes[1];

    if (
      firstChild?.nodeType === Node.TEXT_NODE &&
      firstChild.textContent?.trim() === '"""' &&
      secondChild?.nodeName === 'BR'
    ) {
      // Remove the """ text node and the <br> tag
      p.removeChild(firstChild);
      p.removeChild(secondChild);
    }
  } else {
    const lastChild = p.childNodes[p.childNodes.length - 1];
    const secondToLastChild = p.childNodes[p.childNodes.length - 2];

    if (
      lastChild?.nodeType === Node.TEXT_NODE &&
      lastChild.textContent?.trim() === '"""' &&
      secondToLastChild?.nodeName === 'BR'
    ) {
      p.removeChild(secondToLastChild);
      p.removeChild(lastChild);
    }
  }
}
