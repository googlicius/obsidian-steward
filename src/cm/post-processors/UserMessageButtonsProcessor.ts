import { MarkdownPostProcessor, MarkdownPostProcessorContext, setIcon } from 'obsidian';
import i18next from 'i18next';

export interface UserMessageButtonsOptions {
  /**
   * The callback function to call when the delete button is clicked
   */
  onDeleteClick?: (event: MouseEvent, sourcePath: string) => void;

  /**
   * The callback function to call when the reload button is clicked
   */
  onReloadClick?: (event: MouseEvent, sourcePath: string) => void;
}

/**
 * Creates a markdown post processor that adds action buttons to user-message callouts
 */
export function createUserMessageButtonsProcessor(
  options: UserMessageButtonsOptions = {}
): MarkdownPostProcessor {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const callouts = el.querySelectorAll('.callout[data-callout="stw-user-message"]');

    if (!callouts.length) return;

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i] as HTMLElement;

      // Skip if buttons are already added
      if (callout.querySelector('.stw-user-message-buttons')) continue;

      // Create buttons container
      const buttonsContainer = document.createElement('div');
      buttonsContainer.classList.add('stw-user-message-buttons');

      // Create reload button
      const reloadButton = document.createElement('button');
      reloadButton.classList.add('clickable-icon', 'stw-user-message-button');
      reloadButton.setAttribute('aria-label', i18next.t('Reload response'));
      setIcon(reloadButton, 'refresh-cw');
      reloadButton.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (options.onReloadClick) {
          options.onReloadClick(event, ctx.sourcePath);
        }
      });

      // Create delete button
      const deleteButton = document.createElement('button');
      deleteButton.classList.add('clickable-icon', 'stw-user-message-button');
      deleteButton.setAttribute('aria-label', i18next.t('Delete message'));
      setIcon(deleteButton, 'trash');
      deleteButton.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (options.onDeleteClick) {
          options.onDeleteClick(event, ctx.sourcePath);
        }
      });

      // Add buttons to container
      buttonsContainer.appendChild(reloadButton);
      buttonsContainer.appendChild(deleteButton);

      // Add container to callout
      callout.appendChild(buttonsContainer);
    }
  };
}
