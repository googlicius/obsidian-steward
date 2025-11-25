import { MarkdownPostProcessor } from 'obsidian';
import { logger } from 'src/utils/logger';

/**
 * Creates a markdown post processor that handles the "Thinking process" link click.
 * When clicked, the link is hidden and the thinking block is shown.
 */
export function createThinkingProcessPostProcessor(): MarkdownPostProcessor {
  return (el, ctx) => {
    // Find all code blocks that might be thinking blocks
    const codeBlocks = el.querySelectorAll('pre > code.language-stw-thinking');

    if (!codeBlocks.length) return;

    // We have only one code block in the element
    const codeBlock = codeBlocks[0];

    const preElement = codeBlock.closest('div.el-pre') as HTMLElement;

    if (!preElement) return;

    // Process this element after it is rendered to DOM to be able to access the nextElementSibling element.
    setTimeout(() => {
      // Look for the toggle link after this code block
      const nextElement = preElement.nextElementSibling as HTMLElement;
      if (!nextElement) return;

      const toggleLink = nextElement.querySelector(
        'a[class="stw-thinking-process"]'
      ) as HTMLElement;

      if (!toggleLink) return;

      // Hide the thinking block by default only when there is a toggle link
      preElement.classList.add('stw-hidden');

      // Get the container of the link (usually a callout or paragraph)
      // In the current implementation, it's wrapped in a callout div > p or just div
      const linkContainer = nextElement;

      toggleLink.addEventListener('click', event => {
        event.preventDefault();
        handleClick(linkContainer, preElement);
      });
    });
  };
}

/**
 * Handle the toggle click event
 */
function handleClick(linkContainer: HTMLElement, thinkingBlock: HTMLElement): void {
  try {
    const isVisible = thinkingBlock.classList.contains('stw-visible');

    if (!isVisible) {
      thinkingBlock.classList.add('stw-visible');
      linkContainer.classList.add('stw-hidden');
    }
  } catch (error) {
    logger.error('Error handling thinking process toggle click:', error);
  }
}
