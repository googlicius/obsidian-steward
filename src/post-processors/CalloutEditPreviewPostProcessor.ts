import { MarkdownPostProcessor } from 'obsidian';
import { hasSelectedTextInElement, setupAutoScroll } from 'src/utils/scrollUtils';

/**
 * Creates a markdown post processor that adds click-to-expand behavior
 * on stw-review callouts. These callouts are height-limited by default
 * and expand fully when clicked by toggling the `stw-expanded` CSS class.
 *
 * When `data-streaming="true"` is set (during active streaming), a MutationObserver
 * keeps the callout scrolled to the bottom so the user always sees the latest content.
 */
export function createCalloutEditPreviewPostProcessor(): MarkdownPostProcessor {
  return el => {
    const callouts = el.querySelectorAll('.callout[data-callout="stw-review"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      callout.addEventListener('click', (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'A') return;

        // Skip toggle if the user select something.
        if (callout.classList.contains('stw-expanded') && hasSelectedTextInElement(callout)) return;

        event.preventDefault();
        event.stopPropagation();
        callout.classList.toggle('stw-expanded');
      });

      if (callout.dataset.streaming === 'true') {
        setupAutoScroll(callout);
      }
    }
  };
}
