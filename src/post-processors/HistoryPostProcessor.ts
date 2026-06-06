import { MarkdownPostProcessor, TFile, setIcon, setTooltip } from 'obsidian';
import type StewardPlugin from 'src/main';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { ChatView } from 'src/views/ChatView';

const { i18next } = getBundledInternal('i18n');

function removeHistoryLinkFromContent(params: {
  content: string;
  conversationPath: string;
  fallbackContent: string;
}): string {
  const { content, conversationPath, fallbackContent } = params;

  const historyLines = content.split('\n');
  const updatedLines: string[] = [];
  const escapedPath = conversationPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linePattern = new RegExp(
    `^\\s*(?:-\\s*)?<a[^>]*\\bdata-path="${escapedPath}"[^>]*>.*<\\/a>(?:\\s*<span[^>]*\\bclass="[^"]*stw-history-created[^"]*"[^>]*>.*?<\\/span>)?\\s*$`
  );

  for (const line of historyLines) {
    if (linePattern.test(line.trim())) {
      continue;
    }

    updatedLines.push(line);
  }

  const hasRemainingLinks = updatedLines.some(line => /<a[^>]*\bdata-path="[^"]+"/.test(line));
  if (!hasRemainingLinks) {
    return fallbackContent;
  }

  return updatedLines.join('\n');
}

export function createHistoryPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  const handleDeleteHistoryItem = async (params: {
    event: MouseEvent;
    conversationPath: string;
  }): Promise<void> => {
    const { event, conversationPath } = params;
    event.preventDefault();
    event.stopPropagation();

    const historyNotePath = `${plugin.settings.stewardFolder}/History.md`;
    const historyFile = plugin.app.vault.getFileByPath(historyNotePath);
    if (!(historyFile instanceof TFile)) {
      return;
    }

    await plugin.app.vault.process(historyFile, currentContent =>
      removeHistoryLinkFromContent({
        content: currentContent,
        conversationPath,
        fallbackContent: i18next.t('chat.noConversations'),
      })
    );

    const conversationFilePath = conversationPath.endsWith('.md')
      ? conversationPath
      : `${conversationPath}.md`;
    const conversationFile = plugin.app.vault.getFileByPath(conversationFilePath);
    if (conversationFile) {
      // No need to wait.
      plugin.app.fileManager.trashFile(conversationFile);
    }
  };

  return (el, ctx) => {
    const historyNotePath = `${plugin.settings.stewardFolder}/History.md`;
    if (ctx.sourcePath !== historyNotePath) {
      return;
    }

    const historyLinks = el.querySelectorAll('a[data-path]');
    if (historyLinks.length === 0) {
      return;
    }

    el.classList.add('stw-history-list');

    for (let i = 0; i < historyLinks.length; i++) {
      const linkEl = historyLinks[i];
      if (!(linkEl instanceof HTMLElement)) {
        continue;
      }

      const conversationPath = linkEl.getAttribute('data-path');
      if (!conversationPath) {
        continue;
      }

      let historyItem = linkEl.closest('.stw-history-item');
      if (!(historyItem instanceof HTMLElement)) {
        const parentEl = linkEl.parentElement;
        if (!parentEl) {
          continue;
        }

        historyItem = document.createElement('div');
        historyItem.classList.add('stw-history-item');
        parentEl.insertBefore(historyItem, linkEl);

        let createdEl: HTMLElement | null = null;
        if (
          linkEl.nextElementSibling instanceof HTMLElement &&
          linkEl.nextElementSibling.classList.contains('stw-history-created')
        ) {
          createdEl = linkEl.nextElementSibling;
        }

        historyItem.appendChild(linkEl);
        if (createdEl) {
          historyItem.appendChild(createdEl);
        }
      }

      linkEl.classList.add('stw-history-link');
      linkEl.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          const leaf = await plugin.resolveStewardLeaf();
          await plugin.openChat({ leaf, revealLeaf: true });

          if (!(leaf.view instanceof ChatView)) {
            return;
          }

          await leaf.view.openExistingConversation(conversationPath);
        })();
      });

      const hasDeleteButton = historyItem.querySelector('.stw-history-delete-button');
      if (hasDeleteButton) {
        continue;
      }

      const deleteButton = document.createElement('button');
      deleteButton.classList.add('stw-history-delete-button', 'clickable-icon');
      setTooltip(deleteButton, i18next.t('chat.deleteHistoryItem'));
      setIcon(deleteButton, 'trash-2');
      deleteButton.addEventListener('click', event => {
        void handleDeleteHistoryItem({
          event,
          conversationPath,
        });
      });

      historyItem.appendChild(deleteButton);
    }
  };
}
