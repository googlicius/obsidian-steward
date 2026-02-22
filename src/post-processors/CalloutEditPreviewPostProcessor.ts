import { MarkdownPostProcessor } from 'obsidian';

/**
 * Creates a markdown post processor that adds click-to-expand behavior
 * on stw-edit-preview callouts. These callouts are height-limited by default
 * and expand fully when clicked by toggling the `stw-expanded` CSS class.
 *
 * When `data-streaming="true"` is set (during active streaming), a MutationObserver
 * keeps the callout scrolled to the bottom so the user always sees the latest content.
 */
export function createCalloutEditPreviewPostProcessor(): MarkdownPostProcessor {
  return el => {
    const callouts = el.querySelectorAll('.callout[data-callout="stw-edit-preview"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      callout.addEventListener('click', (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'A') return;

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

function setupAutoScroll(callout: HTMLElement): void {
  const scrollToBottom = () => {
    callout.scrollTop = callout.scrollHeight;
  };

  scrollToBottom();

  const observer = new MutationObserver(scrollToBottom);
  observer.observe(callout, { childList: true, subtree: true, characterData: true });
}
