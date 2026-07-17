import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import {
  usageFrontmatterPropertyName,
  USAGE_AGENT_KEY,
} from 'src/services/ConversationRenderer/Frontmatter';
import {
  Events,
  type ConversationIndicatorChangedPayload,
  type ConversationUsageChangedPayload,
} from 'src/types/events';
import { logger } from 'src/utils/logger';

function normalizeConversationSrc(path: string, stewardFolder: string): string {
  const base = `${stewardFolder}/Conversations/`;
  const withoutExt = path.replace(/\.md$/i, '');
  if (withoutExt.startsWith(base)) return withoutExt;
  return `${base}${withoutExt}`;
}

function buildFooterEmbedSelector(normalizedSrc: string): string {
  const normalizedTitle = normalizedSrc.split('/').pop() || normalizedSrc;
  return `.stw-conversation-indicator[src*="${CSS.escape(normalizedTitle)}"]`;
}

type ConversationFooterElements = {
  footerEl: HTMLElement;
  statusEl: HTMLElement;
  usageEl: HTMLElement;
};

function ensureConversationFooter(params: {
  embedEl: Element;
  footerFor: string;
  createIfMissing?: boolean;
}): ConversationFooterElements | null {
  const contentEl = params.embedEl.querySelector(':scope > .markdown-embed-content');
  if (!contentEl) {
    logger.warn('No contentEl found', params);
    return null;
  }

  const footerSelector = `:scope > .stw-conversation-footer[data-stw-footer-for="${CSS.escape(
    params.footerFor
  )}"]`;
  let footerEl = contentEl.querySelector(footerSelector);

  if (!(footerEl instanceof HTMLElement) && params.createIfMissing) {
    footerEl = activeDocument.createElement('div');
    footerEl.classList.add('stw-conversation-footer');
    footerEl.setAttribute('data-stw-footer-for', params.footerFor);

    const statusEl = activeDocument.createElement('span');
    statusEl.classList.add('stw-conversation-footer-status', 'hidden');

    const usageEl = activeDocument.createElement('span');
    usageEl.classList.add('stw-conversation-footer-usage', 'hidden');

    footerEl.appendChild(statusEl);
    footerEl.appendChild(usageEl);
    contentEl.appendChild(footerEl);
  }

  if (!(footerEl instanceof HTMLElement)) {
    return null;
  }

  const statusEl = footerEl.querySelector('.stw-conversation-footer-status');
  const usageEl = footerEl.querySelector('.stw-conversation-footer-usage');
  if (!statusEl || !usageEl) {
    return null;
  }

  return {
    footerEl,
    statusEl: statusEl as HTMLElement,
    usageEl: usageEl as HTMLElement,
  };
}

function isFooterStatusActive(footer: ConversationFooterElements): boolean {
  return !footer.statusEl.classList.contains('hidden');
}

function syncFooterUsageVisibility(footer: ConversationFooterElements): void {
  const usageText = footer.usageEl.textContent?.trim();
  if (!usageText || isFooterStatusActive(footer)) {
    footer.usageEl.classList.add('hidden');
    return;
  }

  footer.usageEl.classList.remove('hidden');
}

function setFooterStatusState(params: {
  embedEl: Element;
  active: boolean;
  indicatorText?: string;
  createIfMissing?: boolean;
  footerFor: string;
}): void {
  const footer = ensureConversationFooter({
    embedEl: params.embedEl,
    footerFor: params.footerFor,
    createIfMissing: params.active || params.createIfMissing,
  });
  if (!footer) {
    return;
  }

  footer.statusEl.textContent = params.indicatorText ?? 'Planning...';

  if (params.active) {
    footer.statusEl.classList.remove('hidden');
  } else {
    footer.statusEl.classList.add('hidden');
  }

  syncFooterUsageVisibility(footer);
}

function setFooterUsageState(params: {
  embedEl: Element;
  usageText?: string;
  createIfMissing?: boolean;
  footerFor: string;
}): void {
  const usageText = params.usageText?.trim();
  if (!usageText && !params.createIfMissing) {
    return;
  }

  const footer = ensureConversationFooter({
    embedEl: params.embedEl,
    footerFor: params.footerFor,
    createIfMissing: Boolean(usageText) || params.createIfMissing,
  });
  if (!footer) {
    return;
  }

  if (!usageText) {
    footer.usageEl.textContent = '';
    footer.usageEl.classList.add('hidden');
    return;
  }

  footer.usageEl.textContent = usageText;
  syncFooterUsageVisibility(footer);
}

const FOOTER_ATTR = 'data-stw-footer-initialized';

export function createConversationFooterProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  const handleIndicatorChanged = (event: Event) => {
    const { conversationPath, active, indicatorText } = (
      event as CustomEvent<ConversationIndicatorChangedPayload>
    ).detail;
    const normalizedSrc = normalizeConversationSrc(conversationPath, plugin.settings.stewardFolder);
    const selector = buildFooterEmbedSelector(normalizedSrc);
    const embeds = activeDocument.querySelectorAll(selector);

    if (embeds.length === 0) return;

    for (let i = 0; i < embeds.length; i++) {
      setFooterStatusState({
        embedEl: embeds[i],
        active,
        indicatorText,
        footerFor: normalizedSrc,
      });
    }
  };

  const handleUsageChanged = (event: Event) => {
    const { conversationPath, usageText } = (event as CustomEvent<ConversationUsageChangedPayload>)
      .detail;
    const normalizedSrc = normalizeConversationSrc(conversationPath, plugin.settings.stewardFolder);
    const selector = buildFooterEmbedSelector(normalizedSrc);
    const embeds = activeDocument.querySelectorAll(selector);

    if (embeds.length === 0) return;

    for (let i = 0; i < embeds.length; i++) {
      setFooterUsageState({
        embedEl: embeds[i],
        usageText,
        footerFor: normalizedSrc,
      });
    }
  };

  activeDocument.addEventListener(Events.CONVERSATION_INDICATOR_CHANGED, handleIndicatorChanged);
  activeDocument.addEventListener(Events.CONVERSATION_USAGE_CHANGED, handleUsageChanged);

  plugin.register(() => {
    activeDocument.removeEventListener(
      Events.CONVERSATION_INDICATOR_CHANGED,
      handleIndicatorChanged
    );
    activeDocument.removeEventListener(Events.CONVERSATION_USAGE_CHANGED, handleUsageChanged);
  });

  return (el, ctx) => {
    const conversationFolder = `${plugin.settings.stewardFolder}/Conversations`;
    if (!ctx.sourcePath.startsWith(conversationFolder)) return;

    window.setTimeout(() => {
      const embedEl = el.closest('.markdown-embed');
      if (!embedEl) return;
      if (embedEl.hasAttribute(FOOTER_ATTR)) return;

      embedEl.setAttribute(FOOTER_ATTR, 'true');
      embedEl.classList.add('stw-conversation-indicator');
      const normalizedSrc = normalizeConversationSrc(ctx.sourcePath, plugin.settings.stewardFolder);

      const file = plugin.app.vault.getFileByPath(ctx.sourcePath);
      const cache = file ? plugin.app.metadataCache.getFileCache(file) : null;
      const frontmatter = cache?.frontmatter;
      const initialIndicatorText = frontmatter?.indicator_text;
      const conversationLang = typeof frontmatter?.lang === 'string' ? frontmatter.lang : undefined;
      const usageBlock = frontmatter?.[usageFrontmatterPropertyName(USAGE_AGENT_KEY.super)];
      const initialUsage =
        plugin.conversationRenderer.extractLastStepUsageFromFrontmatter(usageBlock);
      const initialUsageText = initialUsage
        ? plugin.conversationRenderer.formatTokenUsageSummary(initialUsage, conversationLang)
        : undefined;

      if (typeof initialIndicatorText === 'string' && initialIndicatorText.trim().length > 0) {
        setFooterStatusState({
          embedEl,
          active: true,
          indicatorText: initialIndicatorText,
          createIfMissing: true,
          footerFor: normalizedSrc,
        });
      } else {
        setFooterStatusState({
          embedEl,
          active: false,
          createIfMissing: true,
          footerFor: normalizedSrc,
        });
      }

      if (initialUsageText) {
        setFooterUsageState({
          embedEl,
          usageText: initialUsageText,
          createIfMissing: true,
          footerFor: normalizedSrc,
        });
      }
    });
  };
}
