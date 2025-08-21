import i18next from 'i18next';
import { MarkdownPostProcessor, setIcon, setTooltip } from 'obsidian';
import type StewardPlugin from 'src/main';

export function createStewardConversationProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  const handleCloseButtonClick = (event: MouseEvent, conversationPath: string) => {
    conversationPath = conversationPath.replace('.md', '');
    const conversationTitle = conversationPath.split('/').pop();
    if (conversationTitle) {
      plugin.closeConversation(conversationTitle);
      plugin.editor.focus();
    }
  };

  const handleSqueezeButtonClick = async (event: MouseEvent, conversationPath: string) => {
    event.preventDefault();
    event.stopPropagation();

    conversationPath = conversationPath.replace('.md', '');
    const conversationTitle = conversationPath.split('/').pop();
    if (conversationTitle) {
      plugin.closeConversation(conversationTitle, 'squeeze');
      plugin.editor.focus();
    }
  };

  return (el, ctx) => {
    const conversationFolder = `${plugin.settings.stewardFolder}/Conversations`;

    // Check if the note is under conversation folder
    if (!ctx.sourcePath.startsWith(conversationFolder)) {
      return;
    }

    // Hack in Post-Processor,
    // When Obsidian renders a note, it builds DOM fragments in memory (not yet inserted into the visible document).
    // This is a workaround to ensure that the stw-conversation class is added to the embed when the note is rendered.
    setTimeout(() => {
      const stwConversation = el.closest('.stw-conversation');

      if (stwConversation) {
        return;
      }

      const embedEl = el.closest('.markdown-embed');
      if (embedEl) {
        // Add stw-conversation class to the embed
        embedEl.classList.add('stw-conversation');

        // delete the markdown-embed-link element
        const markdownEmbedLink = embedEl.querySelector('.markdown-embed-link');
        if (markdownEmbedLink) {
          markdownEmbedLink.remove();
        }

        // Create button container for better positioning
        const buttonContainer = document.createElement('div');
        buttonContainer.classList.add('stw-conversation-buttons');

        // Add squeeze button
        const squeezeButton = document.createElement('button');
        squeezeButton.classList.add('stw-conversation-button', 'clickable-icon');
        setTooltip(squeezeButton, i18next.t('chat.squeezeConversation'));
        setIcon(squeezeButton, 'minimize-2');
        squeezeButton.addEventListener('click', (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          handleSqueezeButtonClick(event, ctx.sourcePath);
        });
        buttonContainer.appendChild(squeezeButton);

        // Add close button
        const closeButton = document.createElement('button');
        closeButton.classList.add('stw-conversation-button', 'clickable-icon');
        setTooltip(closeButton, i18next.t('chat.closeConversation'));
        setIcon(closeButton, 'x');
        closeButton.addEventListener('click', (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          handleCloseButtonClick(event, ctx.sourcePath);
        });
        buttonContainer.appendChild(closeButton);

        // Add the button container to the embed
        embedEl.appendChild(buttonContainer);
      }
    });
  };
}
