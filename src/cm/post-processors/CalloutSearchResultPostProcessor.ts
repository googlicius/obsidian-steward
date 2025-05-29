import { MarkdownPostProcessor, MarkdownPostProcessorContext } from 'obsidian';

type Params = {
	handleClick: (event: MouseEvent) => void;
};

/**
 * Creates a markdown post processor that extracts data from the callout title text
 * and adds them as data attributes to the callout elements.
 *
 * Example: >[!search-result] line:4,pos:1
 * Will be processed into: data-line="4" data-pos="1"
 *
 * This processor only works for search-result callouts, where the title is hidden via CSS.
 */
export function createCalloutSearchResultPostProcessor(params: Params): MarkdownPostProcessor {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		// Find all search-result callouts in the current element
		const callouts = el.querySelectorAll('.callout[data-callout="search-result"]');

		if (!callouts.length) return;

		for (let i = 0; i < callouts.length; i++) {
			const callout = callouts[i] as HTMLElement;
			// Get the callout title element
			const titleEl = callout.querySelector('.callout-title-inner');
			if (!titleEl) return;

			const titleText = titleEl.textContent?.trim() || '';
			if (!titleText) return;

			// Register a click event listener on the callout element
			callout.addEventListener('click', params.handleClick);

			const dataPairs = titleText.split(',');

			// Process each key-value pair
			for (const pair of dataPairs) {
				const [key, value] = pair.split(':').map(s => s.trim());
				if (key && value) {
					callout.dataset[key] = value;
				}
			}
		}
	};
}
