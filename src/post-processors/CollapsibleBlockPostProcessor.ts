import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { setupAutoScroll } from 'src/utils/scrollUtils';

const { i18next } = getBundledInternal('i18n');

const SUPPORTED_BLOCKS = ['stw-thinking', 'cli-model'];

/**
 * Handles:
 * - Auto-scrolling streamed blocks
 * - Toggle visibility for collapsible streamed blocks
 * - Lazy-load archived shell output from `__shell.md` files
 */
export function createCollapsibleBlockPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    // Support all configured language blocks
    const selector = SUPPORTED_BLOCKS.map(lang => `pre > code.language-${lang}`).join(',');

    const codeBlocks = el.querySelectorAll(selector);

    for (let i = 0; i < codeBlocks.length; i++) {
      const code = codeBlocks[i];
      const pre = code.parentElement;

      if (!pre) continue;

      pre.dataset.streaming = 'true';

      if (pre.dataset.stwScrollSetup === 'true' || pre.dataset.streaming !== 'true') {
        continue;
      }

      const section = ctx.getSectionInfo(el);

      if (section) {
        const lines = section.text.split('\n');
        const isToggleLink = lines[section.lineEnd + 1]?.includes('stw-toggle-block');
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

    const toggleLink = el.querySelector('a.stw-toggle-block');

    if (!toggleLink) return;

    // Check for archived shell callout (lazy-load path)
    const callout: HTMLElement | null = toggleLink.closest('[data-callout="stw-shell"]');

    if (callout?.dataset['output_file'] && callout?.dataset['output_anchor']) {
      handleArchivedShellToggle(plugin, toggleLink as HTMLAnchorElement, callout, el);
      return;
    }

    // Wait until rendered so sibling structure exists
    window.setTimeout(() => {
      const prevDivSibling = el.previousElementSibling as HTMLElement | null;

      if (!prevDivSibling) return;

      const blockPreElement = prevDivSibling.querySelector(
        SUPPORTED_BLOCKS.map(code => `pre.language-${code}`).join(',')
      );
      if (!(blockPreElement instanceof HTMLElement)) {
        return;
      }
      const blockPre = blockPreElement;

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
 * Set up click handler for archived shell output: fetch content from
 * the `__shell.md` file and inject it into a dynamically-created pre/code element.
 */
function handleArchivedShellToggle(
  plugin: StewardPlugin,
  toggleLink: HTMLAnchorElement,
  callout: HTMLElement,
  container: HTMLElement
): void {
  toggleLink.addEventListener('click', event => {
    event.preventDefault();

    void (async () => {
      if (callout.dataset['stwShellLoaded'] === 'true') {
        // Content already loaded — just toggle
        const pre = callout.previousElementSibling as HTMLElement | null;
        if (pre) {
          pre.classList.remove('hidden');
          container.classList.add('block');
          container.classList.remove('hidden');
          callout.classList.add('hidden');
        }
        return;
      }

      const filePath = callout.dataset['output_file']!;
      const headingText = callout.dataset['output_anchor']!;

      try {
        const content = await plugin.cliSessionService.shellOutputArchive.readSection(
          filePath,
          headingText
        );

        if (!content) {
          return;
        }

        // Create pre > code element with the fetched content
        const code = activeDocument.createElement('code');
        code.className = 'language-cli-model';
        code.textContent = content;

        const pre = activeDocument.createElement('pre');
        pre.appendChild(code);
        pre.dataset.streaming = 'false';

        // Insert before the callout
        callout.parentElement?.insertBefore(pre, callout);

        callout.dataset['stwShellLoaded'] = 'true';

        // Show the pre, hide the callout
        container.classList.add('block');
        container.classList.remove('hidden');
        callout.classList.add('hidden');
      } catch (error) {
        logger.error('Error loading archived shell output:', error);
      }
    })();
  });
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
