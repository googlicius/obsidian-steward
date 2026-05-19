import { MarkdownPostProcessor } from 'obsidian';
import { logger } from 'src/utils/logger';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { setupAutoScroll } from 'src/utils/scrollUtils';

const { i18next } = getBundledInternal('i18n');

const SUPPORTED_BLOCKS = ['stw-thinking', 'cli-model'];

/**
 * Handles:
 * - Auto-scrolling streamed blocks
 * - Toggle visibility for collapsible streamed blocks
 */
export function createCollapsibleBlockPostProcessor(): MarkdownPostProcessor {
  return (el, ctx) => {
    // Support all configured language blocks
    const selector = SUPPORTED_BLOCKS.map(lang => `pre > code.language-${lang}`).join(',');

    const codeBlocks = el.querySelectorAll(selector);

    for (let i = 0; i < codeBlocks.length; i++) {
      const code = codeBlocks[i];
      const pre = code.parentElement as HTMLElement | null;

      if (!pre) continue;

      pre.dataset.streaming = 'true';

      if (pre.dataset.stwScrollSetup === 'true' || pre.dataset.streaming !== 'true') {
        continue;
      }

      const section = ctx.getSectionInfo(el);

      if (section) {
        const lines = section.text.split('\n');
        const isToggleLink = lines[section.lineEnd + 1].includes('stw-toggle-block');
        const isCliModel = lines[section.lineStart].includes('cli-model');

        if (isCliModel) {
          const lineCount = section.lineEnd - section.lineStart;
          pre.dataset['lineCount'] = String(lineCount);
        }

        // Hide the block that already has the toggle below.
        if (isToggleLink) {
          pre.classList.add('hidden');
        }
      }

      pre.dataset.stwScrollSetup = 'true';
      setupAutoScroll(pre);
    }

    const toggleLink = el.querySelector('a.stw-toggle-block') as HTMLAnchorElement | null;

    if (!toggleLink) return;

    // Wait until rendered so sibling structure exists
    window.setTimeout(() => {
      const prevDivSibling = el.previousElementSibling as HTMLElement | null;

      if (!prevDivSibling) return;

      const blockPre = prevDivSibling.querySelector(
        SUPPORTED_BLOCKS.map(code => `pre.language-${code}`).join(',')
      ) as HTMLElement | null;

      if (!blockPre) return;

      if (blockPre.dataset['lineCount']) {
        toggleLink.textContent = `${i18next.t('common.commandOutput')} (${i18next.t('common.lines', { number: blockPre.dataset['lineCount'] })})`;
      }

      blockPre.dataset.streaming = 'false';

      // Hide block by default when toggle exists
      prevDivSibling.classList.add('hidden');

      toggleLink.addEventListener('click', event => {
        event.preventDefault();

        handleClick(el, prevDivSibling, blockPre);
      });
    });
  };
}

/**
 * Handle the toggle click event
 */
function handleClick(
  linkContainer: HTMLElement,
  blockContainer: HTMLElement,
  blockPre: HTMLElement | null
): void {
  try {
    const isVisible = blockContainer.classList.contains('block');

    if (!isVisible) {
      if (blockPre) {
        blockPre.dataset.streaming = 'false';
        blockPre.classList.remove('hidden');
      }

      blockContainer.classList.remove('hidden');
      blockContainer.classList.add('block');

      linkContainer.classList.add('hidden');
    }
  } catch (error) {
    logger.error('Error handling streaming block toggle click:', error);
  }
}
