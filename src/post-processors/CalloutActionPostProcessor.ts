import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

const STW_INTERACTIVE_CALLOUT_SELECTOR =
  '.callout[data-callout="stw-notify"], .callout[data-callout="stw-actions"]';

/**
 * Wires action buttons inside stw-notify / stw-actions callouts (data-action on buttons).
 */
export function createCalloutActionPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    const callouts = el.querySelectorAll<HTMLElement>(STW_INTERACTIVE_CALLOUT_SELECTOR);
    if (callouts.length === 0) {
      return;
    }

    for (let i = 0; i < callouts.length; i++) {
      const callout = callouts[i];
      if (callout.dataset.stwCalloutActionsBound === '1') {
        continue;
      }
      callout.dataset.stwCalloutActionsBound = '1';

      const buttons = callout.querySelectorAll<HTMLButtonElement>('[data-action]');
      for (let j = 0; j < buttons.length; j++) {
        const button = buttons[j];
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          void handleCalloutAction({
            plugin,
            callout,
            action: button.dataset.action ?? '',
            sourcePath: ctx.sourcePath,
          });
        });
      }
    }
  };
}

async function handleCalloutAction(params: {
  plugin: StewardPlugin;
  callout: HTMLElement;
  action: string;
  sourcePath: string;
}): Promise<void> {
  const calloutType = params.callout.dataset.callout;
  if (!calloutType) {
    return;
  }

  if (params.action === 'never-ask-again') {
    await applyNeverAskAgainSetting(params);
  }

  if (params.action === 'dismiss-version-notify') {
    try {
      await params.plugin.noteContentService.removeVersionNotifyEmbedFromChat();
    } catch (error) {
      logger.error('Failed to remove version notify embed from chat:', error);
    }
    return;
  }

  if (params.action !== 'close' && params.action !== 'never-ask-again') {
    return;
  }

  const metadata: Record<string, string> = {};
  if (params.callout.dataset.lang) {
    metadata.lang = params.callout.dataset.lang;
  }

  try {
    await params.plugin.noteContentService.removeCalloutFromVaultFile({
      filePath: params.sourcePath,
      type: calloutType,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    params.callout.remove();
  } catch (error) {
    logger.error('Failed to remove callout from note:', error);
  }
}

async function applyNeverAskAgainSetting(params: {
  plugin: StewardPlugin;
  callout: HTMLElement;
}): Promise<void> {
  if (params.callout.dataset.callout !== 'stw-notify') {
    return;
  }

  params.plugin.settings.dismissWidgetRefreshNotify = true;
  await params.plugin.saveSettings();
}
