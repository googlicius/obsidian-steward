import { MarkdownPostProcessor } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { StewardChatView } from 'src/views/StewardChatView';
import type StewardPlugin from 'src/main';

const HISTORY_ITEM_PATTERN = /\{\{stw-history-item:([^|]+)\|([^}]+)\}\}/g;

export function createHistoryItemPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    const historyNotePath = `${plugin.settings.stewardFolder}/History.md`;
    if (ctx.sourcePath !== historyNotePath) {
      return;
    }

    if (!el.textContent?.includes('{{stw-history-item:')) {
      return;
    }

    const textNodes = findTextNodesWithRegex(el, new RegExp(HISTORY_ITEM_PATTERN));
    if (textNodes.length === 0) return;

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];
      const textContent = textNode.textContent || '';
      const regex = new RegExp(HISTORY_ITEM_PATTERN);

      let lastIndex = 0;
      let match;

      while ((match = regex.exec(textContent)) !== null) {
        if (match.index > lastIndex) {
          const beforeText = textContent.substring(lastIndex, match.index);
          if (beforeText) {
            replacementElements.push(document.createTextNode(beforeText));
          }
        }

        const conversationPath = match[1];
        const displayText = new MarkdownUtil(match[2]).unescape().getText();

        const link = document.createElement('a');
        link.textContent = displayText;
        link.addEventListener('click', e => {
          const chatLeaf = plugin.getChatLeaf();
          const chatView = chatLeaf.view;
          if (chatView instanceof StewardChatView) {
            e.preventDefault();
            e.stopPropagation();
            chatView.openExistingConversation(conversationPath, { showInput: true });
          }
        });

        replacementElements.push(link);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < textContent.length) {
        const afterText = textContent.substring(lastIndex);
        if (afterText) {
          replacementElements.push(document.createTextNode(afterText));
        }
      }

      if (replacementElements.length > 0) {
        textNode.replaceWith(...replacementElements);
      }
    }
  };
}
