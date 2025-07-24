import { MarkdownPostProcessor, MarkdownPostProcessorContext } from 'obsidian';

type Params = {
  handleClick: (event: MouseEvent) => void;
};

/**
 * Creates a markdown post processor that adds click handling to search result callouts.
 *
 * This processor only works for stw-search-result callouts, where the title is hidden via CSS.
 * The metadata extraction is now handled by CalloutMetadataProcessor.
 */
export function createCalloutSearchResultPostProcessor(params: Params): MarkdownPostProcessor {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    // Find all stw-search-result callouts in the current element
    const callouts = el.querySelectorAll('.callout[data-callout="stw-search-result"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      // Register a click event listener on the callout element
      callout.addEventListener('click', params.handleClick);
    }
  };
}
