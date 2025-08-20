import { MarkdownPostProcessor, Notice, setIcon, setTooltip } from 'obsidian';
import i18next from 'i18next';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

/**
 * Creates a markdown post processor that adds action buttons to user-message callouts
 */
export function createUserMessageButtonsProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  const handleDeleteClick = async (event: MouseEvent, sourcePath: string) => {
    try {
      const calloutEl = (event.target as HTMLElement).closest(
        '.callout[data-callout="stw-user-message"]'
      ) as HTMLElement;
      if (!calloutEl) {
        return;
      }

      const messageId = calloutEl.dataset.id;

      if (!messageId || !sourcePath) {
        logger.log('Could not identify message to delete');
        return;
      }

      // Extract the conversation title from the path
      const title = plugin.conversationRenderer.extractTitleFromPath(sourcePath);

      // Delete the message and all messages below it
      const success = await plugin.conversationRenderer.deleteMessageAndBelow(title, messageId);

      if (!success) {
        new Notice('Failed to delete message');
        return;
      }
    } catch (error) {
      logger.error('Error handling delete button click:', error);
    }
  };

  const handleReloadClick = async (event: MouseEvent, sourcePath: string) => {
    try {
      const calloutEl = (event.target as HTMLElement).closest(
        '.callout[data-callout="stw-user-message"]'
      ) as HTMLElement;
      if (!calloutEl) {
        return;
      }

      const messageId = calloutEl.dataset.id;

      if (!messageId) {
        logger.error('Could not identify message to reload');
        return;
      }

      // Extract the conversation title from the path
      const title = plugin.conversationRenderer.extractTitleFromPath(sourcePath);

      // Get all messages from the conversation
      const allMessages = await plugin.conversationRenderer.extractAllConversationMessages(title);

      // Find the current message by ID
      const currentMessageIndex = allMessages.findIndex(message => message.id === messageId);

      if (currentMessageIndex === -1) {
        new Notice('Could not find message in conversation');
        return;
      }

      // Get the current message
      const currentMessage = allMessages[currentMessageIndex];

      // Find the next message (response to the current message)
      const nextMessageIndex = currentMessageIndex + 1;

      if (nextMessageIndex >= allMessages.length) {
        new Notice('No response message found to reload');
        return;
      }

      // Get the next message ID to delete from
      const nextMessageId = allMessages[nextMessageIndex].id;

      // Delete all messages from the next message onwards
      const success = await plugin.conversationRenderer.deleteMessageAndBelow(title, nextMessageId);

      if (!success) {
        new Notice('Failed to prepare message for reload');
        return;
      }

      // Get the language from the conversation note
      const lang = (await plugin.conversationRenderer.getConversationProperty(
        title,
        'lang'
      )) as string;

      // Determine the command type
      const commandType = currentMessage.command || ' ';

      // Clean the message content by removing any command prefix
      let cleanContent = currentMessage.content;
      if (commandType) {
        const commandPrefix = '/' + commandType;
        if (cleanContent.startsWith(commandPrefix)) {
          cleanContent = cleanContent.substring(commandPrefix.length);
        }
      }

      // Process the command
      await plugin.commandProcessorService.processCommands({
        title,
        commands: [
          {
            commandType,
            query: cleanContent,
          },
        ],
        lang,
        isReloadRequest: true,
      });
    } catch (error) {
      logger.error('Error handling reload button click:', error);
      new Notice(`Error reloading message: ${error.message}`);
    }
  };

  return (el, ctx) => {
    const callouts = el.querySelectorAll('.callout[data-callout="stw-user-message"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      // Skip if buttons are already added
      if (callout.querySelector('.stw-callout-buttons')) continue;

      // Create buttons container
      const buttonsContainer = document.createElement('div');
      buttonsContainer.classList.add('stw-callout-buttons');

      // Create reload button
      const reloadButton = document.createElement('button');
      reloadButton.classList.add('clickable-icon', 'stw-callout-button');
      setTooltip(reloadButton, i18next.t('Reload response'));
      setIcon(reloadButton, 'refresh-cw');
      reloadButton.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        handleReloadClick(event, ctx.sourcePath);
      });

      // Create delete button
      const deleteButton = document.createElement('button');
      deleteButton.classList.add('clickable-icon', 'stw-callout-button');
      setTooltip(deleteButton, i18next.t('Delete message'));
      setIcon(deleteButton, 'trash');
      deleteButton.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        handleDeleteClick(event, ctx.sourcePath);
      });

      // Add buttons to container
      buttonsContainer.appendChild(reloadButton);
      buttonsContainer.appendChild(deleteButton);

      // Add container to callout
      callout.appendChild(buttonsContainer);
    }
  };
}
