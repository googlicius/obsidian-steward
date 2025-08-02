import { MarkdownPostProcessor, TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { EditorView } from '@codemirror/view';
import { logger } from 'src/utils/logger';

/**
 * Creates a markdown post processor that adds click handling to search result callouts.
 *
 * This processor only works for stw-search-result callouts, where the title is hidden via CSS.
 * The metadata extraction is now handled by CalloutMetadataProcessor.
 */
export function createCalloutSearchResultPostProcessor(
  plugin: StewardPlugin
): MarkdownPostProcessor {
  /**
   * Handle clicks on stw-search-result callouts to navigate to the exact match position
   * @param event Mouse event
   */
  const handleSearchResultCalloutClick = async (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'A') {
      logger.log('Click on a link, skipping', target);
      return;
    }

    const calloutEl = target.closest('.callout[data-callout="stw-search-result"]') as HTMLElement;

    // We only handle search result callouts that have position data
    const { line, startLine, endLine, start, end, path } = calloutEl.dataset;

    // Make sure we have the line data at minimum
    if ((!line && (!startLine || !endLine)) || !start || !end) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Get the main leaf for opening the file
    const mainLeaf = await plugin.getMainLeaf();

    let file: TFile | null = null;

    // If path is provided, get that file
    if (path) {
      file = await plugin.mediaTools.findFileByNameOrPath(path);
    }

    // If no path or file not found, use current active file
    if (!file) {
      file = plugin.app.workspace.getActiveFile();

      if (!file) {
        return;
      }
    }

    // Open the file and scroll to the position
    await mainLeaf.openFile(file);

    const startLineNum = parseInt((startLine || line) as string);
    const endLineNum = parseInt((endLine || line) as string);
    const startPos = parseInt(start);
    const endPos = parseInt(end);

    // Add a longer delay to make sure the file is fully loaded and active
    setTimeout(() => {
      // Make sure the leaf is active and focused
      plugin.app.workspace.setActiveLeaf(mainLeaf, { focus: true });
      plugin.app.workspace.revealLeaf(mainLeaf);

      // Get the editor from the file view directly
      const view = mainLeaf.view;
      // @ts-ignore - Access the editor property which exists on MarkdownView but might not be in types
      const editor = view.editor as Editor & {
        cm: EditorView;
      };

      if (!editor) return;

      try {
        // Set cursor position first
        editor.setCursor({ line: startLineNum - 1, ch: 0 });

        // Handle text selection - now supporting multiple lines
        if (!isNaN(startLineNum) && !isNaN(endLineNum)) {
          const from = { line: startLineNum - 1, ch: startPos };
          const to = { line: endLineNum - 1, ch: endPos };

          // Select the text
          editor.setSelection(from, to);
        }

        // Use CM6 scrolling for precise positioning
        if (editor.cm) {
          const linePosition = { line: startLineNum - 1, ch: startPos || 0 };
          const offset = editor.posToOffset(linePosition);

          // Dispatch a scrolling effect to center the cursor
          editor.cm.dispatch({
            effects: EditorView.scrollIntoView(offset, {
              y: 'center',
              yMargin: 50,
            }),
          });
        }
      } catch (error) {
        logger.error('Error navigating to line:', error);
      }
    });
  };

  return (el, ctx) => {
    // Find all stw-search-result callouts in the current element
    const callouts = el.querySelectorAll('.callout[data-callout="stw-search-result"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      // Register a click event listener on the callout element
      callout.addEventListener('click', handleSearchResultCalloutClick);
    }
  };
}
