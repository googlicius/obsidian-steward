import i18next from 'i18next';
import { EventRef, MarkdownPostProcessor, setIcon, setTooltip, TFile } from 'obsidian';
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

  // Shared function to update the conversation title in the embed
  async function updateConversationTitleInEmbed(
    embedEl: Element,
    sourcePath: string
  ): Promise<boolean> {
    try {
      const file = plugin.app.vault.getFileByPath(sourcePath);
      if (file) {
        const cache = plugin.app.metadataCache.getFileCache(file);
        const conversationTitle = cache?.frontmatter?.conversation_title;
        if (conversationTitle) {
          // Find and update the markdown-embed-title element
          const titleEl = embedEl.querySelector('.markdown-embed-title');
          if (titleEl) {
            titleEl.textContent = conversationTitle;
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      // Silently fail if we can't update the title
      console.warn('Failed to update conversation title:', error);
      return false;
    }
  }

  return (el, ctx) => {
    const conversationFolder = `${plugin.settings.stewardFolder}/Conversations`;

    // Check if the note is under conversation folder
    if (!ctx.sourcePath.startsWith(conversationFolder)) {
      return;
    }

    // Hack in Post-Processor,
    // When Obsidian renders a note, it builds DOM fragments in memory (not yet inserted into the visible document).
    // This is a workaround to ensure that the stw-conversation class is added to the embed when the note is rendered.
    setTimeout(async () => {
      const stwConversation = el.closest('.stw-conversation');

      if (stwConversation) {
        return;
      }

      const embedEl = el.closest('.markdown-embed');
      if (embedEl) {
        // Add stw-conversation class to the embed
        embedEl.classList.add('stw-conversation');

        // Update the conversation title
        await updateConversationTitleInEmbed(embedEl, ctx.sourcePath);

        // Register metadata cache change listener for this specific file
        let eventRef: EventRef | null = null;
        let timeoutId: number | null = null;

        const updateTitleAndCleanup = async (file: TFile) => {
          if (file.path === ctx.sourcePath) {
            const updated = await updateConversationTitleInEmbed(embedEl, ctx.sourcePath);

            if (!updated) return;

            // Clean up the event listener and timeout
            if (eventRef) {
              plugin.app.metadataCache.offref(eventRef);
              eventRef = null;
            }
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          }
        };

        // Register the event listener
        eventRef = plugin.app.metadataCache.on('changed', updateTitleAndCleanup);

        // Set a timeout to clean up the event listener after 5 seconds
        timeoutId = window.setTimeout(() => {
          if (eventRef) {
            plugin.app.metadataCache.offref(eventRef);
            eventRef = null;
          }
        }, 5000);

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
