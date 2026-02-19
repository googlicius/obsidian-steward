import { MarkdownPostProcessor } from 'obsidian';
import { StewardChatView } from 'src/views/StewardChatView';
import type StewardPlugin from 'src/main';

export function createHistoryItemPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    const historyNotePath = `${plugin.settings.stewardFolder}/History.md`;
    if (ctx.sourcePath !== historyNotePath) {
      return;
    }

    const historyLinks = el.querySelectorAll('a[data-path]');
    if (historyLinks.length === 0) {
      return;
    }

    historyLinks.forEach(link => {
      if (!(link instanceof HTMLElement)) {
        return;
      }

      const conversationPath = link.getAttribute('data-path');
      if (!conversationPath) {
        return;
      }

      link.addEventListener('click', e => {
        const chatLeaf = plugin.getChatLeaf();
        const chatView = chatLeaf.view;
        if (chatView instanceof StewardChatView) {
          e.preventDefault();
          e.stopPropagation();
          chatView.openExistingConversation(conversationPath, { showInput: true });
        }
      });
    });
  };
}
