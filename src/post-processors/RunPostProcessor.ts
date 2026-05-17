import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';

/**
 * Binds clickable run-links authored in markdown, e.g.:
 * `<a class="stw-run" data-command="ask" data-query="Hello">Run</a>`
 *
 * `data-command` is required (`command_name`). `data-query` is optional and becomes `$from_user` for that run.
 */
export function createRunPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, _ctx): void => {
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
  };
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
