import { MarkdownPostProcessor } from 'obsidian';
import { logger } from 'src/utils/logger';
import { setupAutoScroll } from 'src/utils/scrollUtils';

/**
 * Creates a markdown post processor that handles the "Thinking process" link click.
 * When clicked, the link is hidden and the thinking block is shown.
 */
export function createThinkingProcessPostProcessor(): MarkdownPostProcessor {
  return (el, ctx) => {
    const toggleLink = el.querySelector('a[class="stw-thinking-process"]');
    const codeBlocks = el.querySelectorAll('pre > code.language-stw-thinking');

    for (let i = 0; i < codeBlocks.length; i++) {
      const code = codeBlocks[i];
      const pre = code.parentElement as HTMLElement | null;
      if (!pre) continue;

      pre.dataset.streaming = 'true';

      if (pre.dataset.stwScrollSetup === 'true' || pre.dataset.streaming !== 'true') continue;

      pre.dataset.stwScrollSetup = 'true';
      setupAutoScroll(pre);
    }

    if (!toggleLink) return;

    // Process this element after it is rendered to DOM to be able to access the nextElementSibling element.
    setTimeout(() => {
      const prevDivSibling = el.previousElementSibling as HTMLElement;
      if (!prevDivSibling) return;

      const thinkingPre = prevDivSibling.querySelector(
        'pre.language-stw-thinking'
      ) as HTMLElement | null;

      if (!thinkingPre) return;

      thinkingPre.dataset.streaming = 'false';

      // Hide the thinking block by default only when there is a toggle link
      prevDivSibling.classList.add('hidden');

      toggleLink.addEventListener('click', event => {
        event.preventDefault();
        handleClick(el, prevDivSibling, thinkingPre);
      });
    });
  };
}

/**
 * Handle the toggle click event
 */
function handleClick(
  linkContainer: HTMLElement,
  prevDivSibling: HTMLElement,
  thinkingPre: HTMLElement | null
): void {
  try {
    const isVisible = prevDivSibling.classList.contains('block');

    if (!isVisible) {
      if (thinkingPre) {
        thinkingPre.dataset.streaming = 'false';
      }
      prevDivSibling.classList.remove('hidden');
      prevDivSibling.classList.add('block');
      linkContainer.classList.add('hidden');
    }
  } catch (error) {
    logger.error('Error handling thinking process toggle click:', error);
  }
}
