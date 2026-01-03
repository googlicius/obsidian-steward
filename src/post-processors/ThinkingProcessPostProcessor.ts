import { MarkdownPostProcessor } from 'obsidian';
import { logger } from 'src/utils/logger';

/**
 * Creates a markdown post processor that handles the "Thinking process" link click.
 * When clicked, the link is hidden and the thinking block is shown.
 */
export function createThinkingProcessPostProcessor(): MarkdownPostProcessor {
  return (el, ctx) => {
    const toggleLink = el.querySelector('a[class="stw-thinking-process"]') as HTMLElement;

    if (!toggleLink) return;

    // Process this element after it is rendered to DOM to be able to access the nextElementSibling element.
    setTimeout(() => {
      const prevSibling = el.previousElementSibling as HTMLElement;
      if (!prevSibling) {
        return;
      }

      // Find all code blocks that might be thinking blocks
      const codeBlocks = prevSibling.querySelectorAll('pre > code.language-stw-thinking');

      if (!codeBlocks.length) return;

      // Hide the thinking block by default only when there is a toggle link
      prevSibling.classList.add('hidden');

      toggleLink.addEventListener('click', event => {
        event.preventDefault();
        handleClick(el, prevSibling);
      });
    });
  };
}

/**
 * Handle the toggle click event
 */
function handleClick(linkContainer: HTMLElement, thinkingBlock: HTMLElement): void {
  try {
    const isVisible = thinkingBlock.classList.contains('block');

    if (!isVisible) {
      thinkingBlock.classList.remove('hidden');
      thinkingBlock.classList.add('block');
      linkContainer.classList.add('hidden');
    }
  } catch (error) {
    logger.error('Error handling thinking process toggle click:', error);
  }
}
