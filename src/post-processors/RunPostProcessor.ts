import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { EmbedView } from 'src/views/embed-views/EmbedView';
import { EmbedHistoryView } from 'src/views/embed-views/EmbedHistoryView';
import { EmbedCommandsView } from 'src/views/embed-views/EmbedCommandsView';
import { StewardChatView } from 'src/views/StewardChatView';
import { logger } from 'src/utils/logger';

const stwEmbedViewByKey: Record<string, (plugin: StewardPlugin) => EmbedView> = {
  history: plugin => new EmbedHistoryView(plugin.app, plugin),
  commands: plugin => new EmbedCommandsView(plugin.app, plugin),
};

function createStwEmbedView(plugin: StewardPlugin, key: string): EmbedView | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const factory = stwEmbedViewByKey[trimmed];
  if (!factory) {
    return null;
  }

  return factory(plugin);
}

/**
 * Binds clickable run-links authored in markdown, e.g.:
 * `<a class="stw-run" data-command="ask" data-query="Hello">Run</a>`
 *
 * `data-command` is required (`command_name`). `data-query` is optional and becomes `$from_user` for that run.
 *
 * Also binds embed-links:
 * `<a class="stw-embed" data-embed="history">History</a>`
 * `<a class="stw-embed" data-embed="commands">Community commands</a>`
 *
 * Supported `data-embed` keys are defined on {@link stwEmbedViewByKey}.
 */
export function createRunPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, _ctx): void => {
    bindStwRunLinks(plugin, el);
    bindStwEmbedLinks(plugin, el);
  };
}

function bindStwRunLinks(plugin: StewardPlugin, el: HTMLElement): void {
  const runLinks = el.querySelectorAll('a.stw-run[data-command]');
  if (runLinks.length === 0) {
    return;
  }

  for (let i = 0; i < runLinks.length; i++) {
    const linkEl = runLinks.item(i);
    if (!(linkEl instanceof HTMLAnchorElement)) {
      continue;
    }

    if (linkEl.dataset.stewardRunBound === 'true') {
      continue;
    }
    linkEl.dataset.stewardRunBound = 'true';

    const commandNameRaw = linkEl.dataset.command ?? '';
    const commandName = commandNameRaw.trim();

    linkEl.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        if (!commandName) {
          return;
        }

        const queryRaw = linkEl.dataset.query ?? '';
        const queryDecoded = decodeURIComponentSafe(queryRaw);

        await plugin.userDefinedCommandService.executeClickCommand({
          commandName,
          query: queryDecoded.length > 0 ? queryDecoded : undefined,
        });
      })();
    });
  }
}

function bindStwEmbedLinks(plugin: StewardPlugin, el: HTMLElement): void {
  const embedLinks = el.querySelectorAll('a.stw-embed[data-embed]');
  if (embedLinks.length === 0) {
    return;
  }

  for (let i = 0; i < embedLinks.length; i++) {
    const linkEl = embedLinks.item(i);
    if (!(linkEl instanceof HTMLAnchorElement)) {
      continue;
    }

    if (linkEl.dataset.stewardEmbedBound === 'true') {
      continue;
    }
    linkEl.dataset.stewardEmbedBound = 'true';

    const embedKeyRaw = linkEl.dataset.embed ?? '';
    const embedKey = embedKeyRaw.trim();

    linkEl.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        if (!embedKey) {
          return;
        }

        const embedView = createStwEmbedView(plugin, embedKey);
        if (!embedView) {
          logger.warn(`Unknown stw-embed key: ${embedKey}`);
          return;
        }

        const chatLeaf = await plugin.getChatLeaf();
        const chatView = chatLeaf.view;
        if (!(chatView instanceof StewardChatView)) {
          return;
        }

        await chatView.openEmbedView(embedView);
        plugin.app.workspace.setActiveLeaf(chatLeaf, { focus: true });
      })();
    });
  }
}

/** Best-effort decode so authors can encode spaces and special chars in `data-query`. */
function decodeURIComponentSafe(value: string): string {
  if (value.length === 0) {
    return value;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
