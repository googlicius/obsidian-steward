import { MarkdownPostProcessor } from 'obsidian';
import { MarkdownUtil } from 'src/utils/markdownUtils';

/**
 * Creates a markdown post processor that extracts data from the callout title text
 * and adds them as data attributes to the callout elements.
 *
 * Example: >[!stw-search-result] line:4,pos:1
 * Will be processed into: data-line="4" data-pos="1"
 */
export function createCalloutMetadataProcessor(): MarkdownPostProcessor {
  return (el, ctx) => {
    // Find all supported callouts in the current element
    const callouts = el.querySelectorAll(
      '.callout[data-callout="stw-search-result"], .callout[data-callout="stw-user-message"]'
    );

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      // Get the callout title element
      const titleEl = callout.querySelector('.callout-title-inner');
      if (!titleEl) continue;

      const titleText = titleEl.textContent?.trim() || '';
      if (!titleText) continue;

      const dataPairs = titleText.split(',');

      // Process each key-value pair
      for (const pair of dataPairs) {
        const [key, value] = pair.split(':').map(s => s.trim());
        if (key && value) {
          callout.dataset[key] = new MarkdownUtil(value).unescape().decodeFromDataset().getText();
        }
      }
    }
  };
}
