import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';
import { STW_SOURCE_PATTERN, STW_SOURCE_METADATA_PATTERN } from 'src/constants';

/**
 * Process {{stw-source...}} text nodes into span elements with the friendly text @filename(fromLine-toLine)
 */
export function createStwSourcePostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return async el => {
    if (!el.textContent?.includes('{{stw-source')) {
      return;
    }

    const textNodes = findTextNodesWithRegex(el, new RegExp(STW_SOURCE_PATTERN, 'g'));
    if (textNodes.length === 0) return;

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];

      const textParts = textNode.textContent?.split(new RegExp(STW_SOURCE_PATTERN, 'g')) || [];

      for (const textPart of textParts) {
        if (textPart.startsWith('{{stw-source')) {
          const metadataRegex = new RegExp(STW_SOURCE_METADATA_PATTERN);
          const metadataMatch = textPart.match(metadataRegex);

          if (metadataMatch) {
            const [, sourceType, filePath, fromLine, toLine] = metadataMatch;
            const span = document.createElement('span');
            const baseName = filePath.split('/').pop() || filePath;

            if (fromLine !== undefined && toLine !== undefined) {
              const displayFromLine = parseInt(fromLine) + 1;
              const displayToLine = parseInt(toLine) + 1;
              span.textContent = `@${baseName} (${displayFromLine}-${displayToLine})`;
            } else if (sourceType === 'folder') {
              span.textContent = `@${baseName}/`;
            } else {
              span.textContent = `@${baseName}`;
            }

            span.addClass('stw-source-button', 'stw-mr-2');
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
