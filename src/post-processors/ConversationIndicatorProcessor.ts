import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import { Events, type ConversationIndicatorChangedPayload } from 'src/types/events';

function normalizeConversationSrc(path: string, stewardFolder: string): string {
  const base = `${stewardFolder}/Conversations/`;
  const withoutExt = path.replace(/\.md$/i, '');
  if (withoutExt.startsWith(base)) return withoutExt;
  return `${base}${withoutExt}`;
}

function setGeneratingIndicatorState(params: {
  embedEl: Element;
  active: boolean;
  indicatorText?: string;
  createIfMissing?: boolean;
  indicatorFor: string;
}): void {
  const contentEl = params.embedEl.querySelector(':scope > .markdown-embed-content');
  if (!contentEl) return;

  const indicatorSelector = `:scope > .generating-indicator[data-stw-indicator-for="${CSS.escape(
    params.indicatorFor
  )}"]`;
  let indicatorEl = contentEl.querySelector(indicatorSelector);

  if (!indicatorEl && (params.active || params.createIfMissing)) {
    indicatorEl = document.createElement('div');
    indicatorEl.classList.add('generating-indicator');
    indicatorEl.setAttribute('data-stw-indicator-for', params.indicatorFor);

    const textEl = document.createElement('span');
    textEl.classList.add('generating-indicator-text');
    indicatorEl.appendChild(textEl);
    contentEl.appendChild(indicatorEl);
  }

  if (!indicatorEl) return;

  const textEl = indicatorEl.querySelector('.generating-indicator-text');
  if (textEl) {
    textEl.textContent = params.indicatorText ?? 'Planning...';
  }

  if (params.active) {
    indicatorEl.classList.remove('hidden');
    return;
  }

  indicatorEl.classList.add('hidden');
}

const INDICATOR_ATTR = 'data-stw-indicator-initialized';

export function createConversationIndicatorProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  const handleIndicatorChanged = (event: CustomEvent<ConversationIndicatorChangedPayload>) => {
    const { conversationPath, active, indicatorText } = event.detail;
    const normalizedSrc = normalizeConversationSrc(conversationPath, plugin.settings.stewardFolder);
    const normalizedTitle = normalizedSrc.split('/').pop() || normalizedSrc;
    const selector = [
      `.stw-conversation-indicator[src="${CSS.escape(normalizedSrc)}"]`,
      `.stw-conversation-indicator[src="${CSS.escape(normalizedTitle)}"]`,
    ].join(', ');
    const embeds = document.querySelectorAll(selector);
    if (embeds.length === 0) return;

    for (let i = 0; i < embeds.length; i++) {
      setGeneratingIndicatorState({
        embedEl: embeds[i],
        active,
        indicatorText,
        indicatorFor: normalizedSrc,
      });
    }
  };

  document.addEventListener(Events.CONVERSATION_INDICATOR_CHANGED, handleIndicatorChanged);

  plugin.register(() => {
    document.removeEventListener(Events.CONVERSATION_INDICATOR_CHANGED, handleIndicatorChanged);
  });

  return (el, ctx) => {
    const conversationFolder = `${plugin.settings.stewardFolder}/Conversations`;
    if (!ctx.sourcePath.startsWith(conversationFolder)) return;

    setTimeout(() => {
      const embedEl = el.closest('.markdown-embed');
      if (!embedEl) return;
      if (embedEl.hasAttribute(INDICATOR_ATTR)) return;

      embedEl.setAttribute(INDICATOR_ATTR, 'true');
      embedEl.classList.add('stw-conversation-indicator');
      const normalizedSrc = normalizeConversationSrc(ctx.sourcePath, plugin.settings.stewardFolder);

      const file = plugin.app.vault.getFileByPath(ctx.sourcePath);
      const cache = file ? plugin.app.metadataCache.getFileCache(file) : null;
      const initialIndicatorText = cache?.frontmatter?.indicator_text;

      if (typeof initialIndicatorText === 'string' && initialIndicatorText.trim().length > 0) {
        setGeneratingIndicatorState({
          embedEl,
          active: true,
          indicatorText: initialIndicatorText,
          createIfMissing: true,
          indicatorFor: normalizedSrc,
        });
        return;
      }

      setGeneratingIndicatorState({
        embedEl,
        active: false,
        createIfMissing: true,
        indicatorFor: normalizedSrc,
      });
    });
  };
}
