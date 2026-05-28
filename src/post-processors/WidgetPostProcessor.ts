import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import {
  getWidgetFenceLanguage,
  type WidgetType,
  WIDGET_TYPES,
} from 'src/solutions/commands/agents/handlers/ShowWidget';
import {
  WIDGET_PROJECT_FENCE_LANGUAGE,
  buildWidgetSrcdoc,
  WIDGET_RESIZE,
} from 'src/services/WidgetService';
import { logger } from 'src/utils/logger';

const WIDGET_FENCE_SELECTOR = WIDGET_TYPES.map(
  t => `pre > code.language-${getWidgetFenceLanguage(t)}`
).join(',');
const WIDGET_PROJECT_FENCE_SELECTOR = `pre > code.language-${WIDGET_PROJECT_FENCE_LANGUAGE}`;

function getWidgetType(code: HTMLElement): WidgetType | null {
  return (
    WIDGET_TYPES.find(t => code.classList.contains(`language-${getWidgetFenceLanguage(t)}`)) ?? null
  );
}

function mountIframe(container: HTMLElement, type: WidgetType, code: string): () => void {
  const { srcdoc, sandbox, usesPostMessageResize } = buildWidgetSrcdoc({ type, code });

  const iframe = Object.assign(document.createElement('iframe'), {
    className: 'stw-widget-frame',
    title: 'Widget',
    srcdoc,
  });
  iframe.setAttribute('sandbox', sandbox);
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('loading', 'lazy');
  container.appendChild(iframe);

  let resizeObserver: ResizeObserver | undefined;

  const syncHeight = () => {
    const doc = iframe.contentDocument;
    const h = Math.max(doc?.documentElement.scrollHeight ?? 0, doc?.body?.scrollHeight ?? 0);
    if (h > 0) iframe.style.height = `${h}px`;
  };

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow || e.data?.type !== WIDGET_RESIZE) return;
    const h = Number(e.data.height);
    if (Number.isFinite(h) && h > 0) iframe.style.height = `${h}px`;
  };

  const onLoad = () => {
    if (usesPostMessageResize) return;
    if (!iframe.contentDocument || !iframe.contentDocument) return;
    syncHeight();
    resizeObserver = new ResizeObserver(syncHeight);
    resizeObserver.observe(iframe.contentDocument.body);
    resizeObserver.observe(iframe.contentDocument.documentElement);
  };

  iframe.addEventListener('load', onLoad);
  if (usesPostMessageResize) window.addEventListener('message', onMessage);

  return () => {
    iframe.removeEventListener('load', onLoad);
    if (usesPostMessageResize) window.removeEventListener('message', onMessage);
    resizeObserver?.disconnect();
  };
}

function watchRemoval(container: HTMLElement, teardown: () => void): void {
  const root = container.closest('.workspace-leaf-content, .workspace-leaf') ?? document.body;
  const observer = new MutationObserver(() => {
    if (root.contains(container)) return;
    observer.disconnect();
    teardown();
    delete container.dataset.stwWidgetMounted;
  });
  observer.observe(root, { childList: true, subtree: true });
}

function makeContainer(type: string): HTMLElement {
  const el = document.createElement('div');
  el.classList.add('stw-widget-container');
  el.dataset.stwWidgetType = type;
  return el;
}

function mountWidget(pre: HTMLElement, type: WidgetType, code: string): void {
  if (pre.dataset.stwWidgetMounted === '1' || !code.trim()) return;
  pre.dataset.stwWidgetMounted = '1';
  const container = makeContainer(type);
  pre.replaceWith(container);
  watchRemoval(container, mountIframe(container, type, code));
}

async function mountWidgetProject(
  pre: HTMLElement,
  code: HTMLElement,
  plugin: StewardPlugin
): Promise<void> {
  if (pre.dataset.stwWidgetMounted === '1') return;
  const parsed = plugin.widgetService.parseProjectFenceContent(code.textContent ?? '');
  if (!parsed)
    return void logger.warn('Cannot parse widget project fence', { rawFence: code.textContent });

  pre.dataset.stwWidgetMounted = '1';
  const container = makeContainer('html');
  container.dataset.stwWidgetProjectPath = parsed.projectPath;
  container.dataset.stwWidgetId = parsed.widgetId;
  pre.replaceWith(container);

  let teardownIframe: (() => void) | undefined;
  let unregister: (() => void) | undefined;

  watchRemoval(container, () => {
    teardownIframe?.();
    unregister?.();
    delete container.dataset.stwWidgetMounted;
  });

  try {
    const { widgetService } = plugin;
    const bundled = await widgetService.bundleProject(parsed.projectPath);

    const refresh = async () => {
      try {
        const next = await widgetService.bundleProject(parsed.projectPath);
        const { srcdoc } = buildWidgetSrcdoc({ type: 'html', code: next });
        const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
        if (iframe) iframe.srcdoc = srcdoc;
      } catch (e) {
        logger.error('Failed to refresh widget project:', e);
      }
    };

    unregister = widgetService.registerMountedWidget({
      container,
      projectPath: parsed.projectPath,
      refresh,
    });
    teardownIframe = mountIframe(container, 'html', bundled);
  } catch (e) {
    logger.error('Failed to mount widget project:', e);
    container.textContent = 'Failed to load widget project.';
  }
}

export function createWidgetPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return el => {
    window.setTimeout(() => {
      el.querySelectorAll<HTMLElement>(WIDGET_PROJECT_FENCE_SELECTOR).forEach(code => {
        const pre = code.parentElement;
        if (pre?.tagName === 'PRE') void mountWidgetProject(pre, code, plugin);
      });

      el.querySelectorAll<HTMLElement>(WIDGET_FENCE_SELECTOR).forEach(code => {
        const pre = code.parentElement;
        const type = getWidgetType(code);
        if (pre?.tagName === 'PRE' && type) mountWidget(pre, type, code.textContent ?? '');
      });
    });
  };
}
