import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import { findTextNodesWithRegex } from 'src/utils/findTextNode';
import { STW_SELECTED_PATTERN, STW_SELECTED_METADATA_PATTERN } from 'src/constants';

/**
 * Process {{stw-selected...}} text nodes into span elements with the friendly text @filename(fromLine-toLine)
 */
export function createStwSelectedPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return async el => {
    // Early exit: Check if element contains the pattern before expensive DOM traversal
    if (!el.textContent?.includes('{{stw-selected')) {
      return;
    }

    // Find all text nodes containing the pattern
    const textNodes = findTextNodesWithRegex(el, new RegExp(STW_SELECTED_PATTERN, 'g'));
    if (textNodes.length === 0) return;

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];

      const textParts = textNode.textContent?.split(new RegExp(STW_SELECTED_PATTERN, 'g')) || [];

      for (const textPart of textParts) {
        if (textPart.startsWith('{{stw-selected')) {
          const metadataRegex = new RegExp(STW_SELECTED_METADATA_PATTERN);
          const metadataMatch = textPart.match(metadataRegex);

          if (metadataMatch) {
            const [, fromLine, toLine, , filePath] = metadataMatch;
            const span = document.createElement('span');
            const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || 'Unknown';
            // Display 1-based line numbers (add 1 to 0-based stored values)
            const displayFromLine = parseInt(fromLine) + 1;
            const displayToLine = parseInt(toLine) + 1;
            span.textContent = `@${fileName} (${displayFromLine}-${displayToLine})`;
            span.addClass('stw-selected-button', 'mr-2');

            replacementElements.push(span);
          }
        } else {
          replacementElements.push(document.createTextNode(textPart));
        }
      }

      textNode.replaceWith(...replacementElements);
    }
  };
}
