import { MarkdownPostProcessor } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/findTextNode';
import { CONFIRMATION_BUTTONS_PATTERN } from 'src/constants';
import type StewardPlugin from 'src/main';

/**
 * Process {{stw-confirmation-buttons}} markers into Yes/No buttons
 */
export function createConfirmationButtonsProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  function handleYesClick(event: MouseEvent, conversationTitle?: string) {
    if (conversationTitle) {
      plugin.conversationRenderer.removeConfirmationButtons(conversationTitle);
      plugin.commandProcessorService.commandProcessor.processIntents({
        title: conversationTitle,
        intents: [
          {
            type: ' ',
            query: 'Yes',
          },
        ],
      });
    }
  }

  function handleNoClick(event: MouseEvent, conversationTitle?: string) {
    if (conversationTitle) {
      plugin.conversationRenderer.removeConfirmationButtons(conversationTitle);
      plugin.commandProcessorService.commandProcessor.processIntents({
        title: conversationTitle,
        intents: [
          {
            type: ' ',
            query: 'No',
          },
        ],
      });
    }
  }

  return el => {
    // Early exit: Check if element contains the pattern before expensive DOM traversal
    if (!el.textContent?.includes('{{stw-confirmation-buttons')) {
      return;
    }

    // Find all text nodes containing the pattern
    const textNodes = findTextNodesWithRegex(el, new RegExp(CONFIRMATION_BUTTONS_PATTERN, 'g'));
    if (textNodes.length === 0) return;

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];
      const textContent = textNode.textContent || '';

      // Use matchAll to find all marker occurrences
      const regex = new RegExp(CONFIRMATION_BUTTONS_PATTERN, 'g');
      let lastIndex = 0;
      let match;

      // Process all matches
      while ((match = regex.exec(textContent)) !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
          const beforeText = textContent.substring(lastIndex, match.index);
          if (beforeText) {
            replacementElements.push(document.createTextNode(beforeText));
          }
        }

        // Extract conversation title from match (group 1)
        const conversationTitle = match[1]?.trim() || '';

        // Create buttons container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('stw-confirmation-buttons');

        // Create Yes button
        buttonsContainer
          .createEl('button', {
            text: 'Yes',
            cls: 'mod-cta',
          })
          .addEventListener('click', (event: MouseEvent) =>
            handleYesClick(event, conversationTitle)
          );

        // Create No button
        buttonsContainer
          .createEl('button', {
            text: 'No',
          })
          .addEventListener('click', (event: MouseEvent) =>
            handleNoClick(event, conversationTitle)
          );

        replacementElements.push(buttonsContainer);

        lastIndex = match.index + match[0].length;
      }

      // Add remaining text after the last match
      if (lastIndex < textContent.length) {
        const afterText = textContent.substring(lastIndex);
        if (afterText) {
          replacementElements.push(document.createTextNode(afterText));
        }
      }

      // Replace the original text node only if we created replacements
      if (replacementElements.length > 0) {
        textNode.replaceWith(...replacementElements);
      }
    }
  };
}
