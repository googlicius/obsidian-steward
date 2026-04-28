import { MarkdownPostProcessor } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';
import { CONFIRMATION_BUTTONS_PATTERN } from 'src/constants';
import type StewardPlugin from 'src/main';
import { getTranslation } from 'src/i18n';

function decodeMarkerSeg(raw: string | undefined): string | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

/**
 * Process {{stw-confirmation-buttons}} markers into confirm/reject buttons (default Yes / No).
 */
export function createConfirmationButtonsProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  function handleAffirmativeClick(_event: MouseEvent, conversationTitle: string | undefined) {
    if (conversationTitle) {
      plugin.conversationRenderer.removeConfirmationButtons(conversationTitle);
      plugin.commandProcessorService.commandProcessor.processIntents({
        title: conversationTitle,
        intents: [
          {
            type: 'user_confirm',
            query: 'Yes',
          },
        ],
      });
    }
  }

  function handleRejectClick(_event: MouseEvent, conversationTitle: string | undefined) {
    if (conversationTitle) {
      plugin.conversationRenderer.removeConfirmationButtons(conversationTitle);
      plugin.commandProcessorService.commandProcessor.processIntents({
        title: conversationTitle,
        intents: [
          {
            type: 'user_confirm',
            query: 'No',
          },
        ],
      });
    }
  }

  return async el => {
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

        const [, titleEnc, confirmEnc, rejectEnc] = match;
        const convTitle = decodeMarkerSeg(titleEnc) ?? '';

        const lang = await plugin.conversationRenderer.getConversationProperty<string>(
          convTitle,
          'lang'
        );
        const t = getTranslation(lang);

        const affirmativeText = decodeMarkerSeg(confirmEnc) ?? t('ui.yes');
        const rejectText = decodeMarkerSeg(rejectEnc) ?? t('ui.no');

        // Create buttons container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('stw-confirmation-buttons');

        buttonsContainer
          .createEl('button', {
            text: affirmativeText,
            cls: 'mod-cta',
          })
          .addEventListener('click', (event: MouseEvent) =>
            handleAffirmativeClick(event, convTitle)
          );

        buttonsContainer
          .createEl('button', {
            text: rejectText,
          })
          .addEventListener('click', (event: MouseEvent) => handleRejectClick(event, convTitle));

        buttonsContainer.createEl('span', {
          cls: 'hint',
          text: t('ui.orTypeToSkip'),
        });

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
