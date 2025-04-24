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
			// Count instances of triple quotes to handle complex cases
			// where an element might contain both opening and closing markers
			const matches = text.match(/"""/g) || [];
			const tripleQuoteCount = matches.length;

			// If the element consists of only """, possibly with whitespace
			if (text === '"""' || /^\s*"""\s*$/.test(text)) {
				if (!inBlock) {
					// Start of block
					el.classList.add('st-triple-block');
					el.classList.add('st-triple-block-start');
					inBlock = true;
				} else {
					// End of block
					el.classList.add('st-triple-block');
					el.classList.add('st-triple-block-end');
					inBlock = false;
				}
			} else {
				// Element contains triple quotes and other content
				el.classList.add('st-triple-block');

				// Check if this element starts with triple quotes (ignoring whitespace)
				if (/^\s*"""/.test(text)) {
					el.classList.add('st-triple-block-start');
					inBlock = true;
				}

				// Check if this element ends with triple quotes (ignoring whitespace)
				if (/"""\s*$/.test(text)) {
					el.classList.add('st-triple-block-end');
					inBlock = false;
				}

				// Handle multiple triple quotes in a single element
				// If there's an even number, this element is self-contained
				if (tripleQuoteCount > 1 && tripleQuoteCount % 2 === 0) {
					// Element has matching pairs, add both classes
					el.classList.add('st-triple-block-start');
					el.classList.add('st-triple-block-end');
					// inBlock state remains unchanged after this element
					inBlock = false;
				}
			}
		} else if (inBlock) {
			// This element is inside a block but doesn't contain triple quotes
			el.classList.add('st-triple-block');
		}
	};
}
