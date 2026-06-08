import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { ViewBuilder } from 'src/views/view-builders/ViewBuilder';
import { refreshViewBuilder } from 'src/views/view-builders/ViewBuilder';
import { HistoryViewBuilder } from 'src/views/view-builders/HistoryViewBuilder';
import { CommandsViewBuilder } from 'src/views/view-builders/CommandsViewBuilder';
import { logger } from 'src/utils/logger';

const viewBuilderByKey: Record<string, (plugin: StewardPlugin) => ViewBuilder> = {
  history: plugin => new HistoryViewBuilder(plugin.app, plugin),
  commands: plugin => new CommandsViewBuilder(plugin.app, plugin),
};

function createViewBuilder(plugin: StewardPlugin, key: string): ViewBuilder | null {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const factory = viewBuilderByKey[trimmed];
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
 * Supported `data-embed` keys are defined on {@link viewBuilderByKey}.
 */
export function createRunPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, _ctx): void => {
    // Wait until rendered so links are in the live DOM (post-processors run on fragments first)
    window.setTimeout(() => {
      bindStwRunLinks(plugin, el);
      bindStwEmbedLinks(plugin, el);
    });
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

    if (linkEl.dataset.bound === 'true') {
      continue;
    }
    linkEl.dataset.bound = 'true';

    const commandNameRaw = linkEl.dataset.command ?? '';
    const commandName = commandNameRaw.trim();

    linkEl.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      void (async () => {
        if (!commandName) {
          logger.warn(`Command is empty.`);
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

        const builder = createViewBuilder(plugin, embedKey);
        if (!builder) {
          logger.warn(`Unknown stw-embed key: ${embedKey}`);
          return;
        }

        await refreshViewBuilder(builder);
        const leaf = await plugin.resolveStewardLeaf();
        await plugin.openReadingView({ filePath: builder.getFilePath(), leaf });
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
