import { MarkdownPostProcessor } from 'obsidian';
import { logger } from 'src/utils/logger';

/**
 * Creates a markdown post processor that handles toggle functionality for extraction explanation YAML blocks
 */
export function createExtractionDetailsLinkProcessor(): MarkdownPostProcessor {
  return (el, ctx) => {
    // Find all code blocks that might be YAML extraction explanations
    const codeBlocks = el.querySelectorAll('pre > code.language-yaml');

    if (!codeBlocks.length) return;

    // We have only one code block in the element
    const codeBlock = codeBlocks[0];

    const preElement = codeBlock.closest('div.el-pre') as HTMLElement;

    if (!preElement) return;

    // Check if the content looks like an extraction explanation
    if (!codeBlock.textContent?.includes('name: Extraction details')) return;

    preElement.classList.add('stw-hidden');

    // Process this element after it is rendered to DOM to be able to access the previousElementSibling element.
    setTimeout(() => {
      // Look for the toggle link before this code block
      const previousElement = preElement.previousElementSibling as HTMLElement;
      if (!previousElement) return;

      const toggleLink = previousElement.querySelector(
        'a[class="stw-extraction-details-link"]'
      ) as HTMLElement;
      if (!toggleLink) return;

      toggleLink.addEventListener('click', event => {
        event.preventDefault();
        handleClick(toggleLink, preElement);
      });
    });
  };
}

/**
 * Handle the toggle click event
 */
function handleClick(toggleLink: HTMLElement, yamlBlock: HTMLElement): void {
  try {
    const isVisible = yamlBlock.classList.contains('stw-visible');

    if (!isVisible) {
      yamlBlock.classList.add('stw-visible');
      toggleLink.classList.add('stw-hidden');
    }
  } catch (error) {
    logger.error('Error handling extraction toggle click:', error);
  }
}
