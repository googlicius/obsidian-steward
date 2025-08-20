import { MarkdownPostProcessor, MarkdownView, TFile, setIcon, setTooltip, Notice } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import i18next from 'i18next';

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

      const editor = view instanceof MarkdownView ? view.editor : null;

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

        const linePosition = { line: startLineNum - 1, ch: startPos || 0 };

        editor.scrollIntoView({ from: linePosition, to: linePosition }, true);
      } catch (error) {
        logger.error('Error navigating to line:', error);
      }
    });
  };

  /**
   * Handle copy button click to copy the search result content to clipboard
   * @param event Mouse event
   */
  const handleCopyButtonClick = async (event: MouseEvent) => {
    // Prevent the event from bubbling up to the callout click handler
    event.preventDefault();
    event.stopPropagation();

    const target = event.target as HTMLElement;
    if (target.tagName === 'A') {
      logger.log('Click on a link, skipping', target);
      return;
    }

    const calloutEl = target.closest('.callout[data-callout="stw-search-result"]') as HTMLElement;

    const { mdContent } = calloutEl.dataset;

    if (!mdContent) {
      return;
    }

    try {
      await navigator.clipboard.writeText(mdContent);

      // Show success notification
      new Notice(i18next.t('ui.contentCopied'));
    } catch (error) {
      logger.error('Failed to copy content to clipboard:', error);
      new Notice(i18next.t('ui.copyFailed'));
    }
  };

  return el => {
    // Find all stw-search-result callouts in the current element
    const callouts = el.querySelectorAll('.callout[data-callout="stw-search-result"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      // Check if it has mdContent data
      const { mdContent } = callout.dataset;
      if (mdContent) {
        // Skip if buttons are already added
        if (callout.querySelector('.stw-callout-buttons')) continue;

        // Create buttons container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('stw-callout-buttons');

        // Create copy button
        const copyButton = document.createElement('button');
        copyButton.classList.add('clickable-icon', 'stw-callout-button');
        setTooltip(copyButton, i18next.t('Copy'));
        setIcon(copyButton, 'copy');
        copyButton.addEventListener('click', handleCopyButtonClick);

        // Add button to container
        buttonsContainer.appendChild(copyButton);

        // Add container to callout
        callout.appendChild(buttonsContainer);
      }

      // Register a click event listener on the callout element
      callout.addEventListener('click', handleSearchResultCalloutClick);
    }
  };
}
