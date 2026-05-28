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
  type => `pre > code.language-${getWidgetFenceLanguage(type)}`
).join(',');

const WIDGET_PROJECT_FENCE_SELECTOR = `pre > code.language-${WIDGET_PROJECT_FENCE_LANGUAGE}`;

function parseWidgetTypeFromCodeElement(code: HTMLElement): WidgetType | null {
  for (let i = 0; i < WIDGET_TYPES.length; i++) {
    const type = WIDGET_TYPES[i];
    if (code.classList.contains(`language-${getWidgetFenceLanguage(type)}`)) {
      return type;
    }
  }
  return null;
}

function syncIframeHeight(iframe: HTMLIFrameElement): void {
  const doc = iframe.contentDocument;
  if (!doc) {
    return;
  }

  const height = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
  if (height <= 0) {
    return;
  }

  iframe.style.height = `${height}px`;
}

function mountWidgetIframe(params: {
  container: HTMLElement;
  type: WidgetType;
  code: string;
}): () => void {
  const { srcdoc, sandbox, usesPostMessageResize } = buildWidgetSrcdoc({
    type: params.type,
    code: params.code,
  });

  const iframe = document.createElement('iframe');
  iframe.classList.add('stw-widget-frame');
  iframe.setAttribute('sandbox', sandbox);
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('loading', 'lazy');
  iframe.title = 'Widget';
  iframe.srcdoc = srcdoc;

  params.container.appendChild(iframe);

  let resizeObserver: ResizeObserver | undefined;

  const onResizeFromIframe = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) {
      return;
    }
    if (event.data?.type !== WIDGET_RESIZE) {
      return;
    }
    const height = Number(event.data.height);
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    iframe.style.height = `${height}px`;
  };

  if (usesPostMessageResize) {
    window.addEventListener('message', onResizeFromIframe);
  }

  const onLoad = (): void => {
    if (usesPostMessageResize) {
      return;
    }

    syncIframeHeight(iframe);

    const doc = iframe.contentDocument;
    if (!doc?.body) {
      return;
    }

    resizeObserver = new ResizeObserver(() => {
      syncIframeHeight(iframe);
    });
    resizeObserver.observe(doc.body);
    resizeObserver.observe(doc.documentElement);
  };

  iframe.addEventListener('load', onLoad);

  return () => {
    iframe.removeEventListener('load', onLoad);
    if (usesPostMessageResize) {
      window.removeEventListener('message', onResizeFromIframe);
    }
    resizeObserver?.disconnect();
  };
}

function mountWidgetBlock(params: { pre: HTMLElement; code: HTMLElement; type: WidgetType }): void {
  if (params.pre.dataset.stwWidgetMounted === '1') {
    return;
  }

  const rawCode = params.code.textContent ?? '';
  if (rawCode.trim().length === 0) {
    return;
  }

  params.pre.dataset.stwWidgetMounted = '1';

  const container = document.createElement('div');
  container.classList.add('stw-widget-container');
  container.dataset.stwWidgetType = params.type;

  params.pre.replaceWith(container);

  const teardown = mountWidgetIframe({
    container,
    type: params.type,
    code: rawCode,
  });

  attachRemovalWatcher(container, teardown);
}

function mountWidgetProjectBlock(params: {
  pre: HTMLElement;
  code: HTMLElement;
  plugin: StewardPlugin;
}): void {
  if (params.pre.dataset.stwWidgetMounted === '1') {
    return;
  }

  const rawFence = params.code.textContent ?? '';
  const parsed = params.plugin.widgetService.parseProjectFenceContent(rawFence);
  if (!parsed) {
    logger.warn('Cannot parse widget project fence', { rawFence });
    return;
  }

  params.pre.dataset.stwWidgetMounted = '1';

  const container = document.createElement('div');
  container.classList.add('stw-widget-container');
  container.dataset.stwWidgetType = 'html';
  container.dataset.stwWidgetProjectPath = parsed.projectPath;
  container.dataset.stwWidgetId = parsed.widgetId;

  params.pre.replaceWith(container);

  let teardownIframe: (() => void) | undefined;
  let unregisterMounted: (() => void) | undefined;

  const mount = async (): Promise<void> => {
    try {
      const widgetService = params.plugin.widgetService;
      const bundled = await widgetService.bundleProject(parsed.projectPath);

      const refresh = async (): Promise<void> => {
        try {
          const nextBundled = await widgetService.bundleProject(parsed.projectPath);
          const { srcdoc: nextSrcdoc } = buildWidgetSrcdoc({
            type: 'html',
            code: nextBundled,
          });
          const iframe = container.querySelector('iframe.stw-widget-frame');
          if (iframe instanceof HTMLIFrameElement) {
            iframe.srcdoc = nextSrcdoc;
          }
        } catch (error) {
          logger.error('Failed to refresh widget project:', error);
        }
      };

      unregisterMounted = widgetService.registerMountedWidget({
        container,
        projectPath: parsed.projectPath,
        refresh,
      });

      teardownIframe = mountWidgetIframe({
        container,
        type: 'html',
        code: bundled,
      });
    } catch (error) {
      logger.error('Failed to mount widget project:', error);
      container.textContent = 'Failed to load widget project.';
    }
  };

  attachRemovalWatcher(container, () => {
    teardownIframe?.();
    unregisterMounted?.();
    delete container.dataset.stwWidgetMounted;
  });

  void mount();
}

function attachRemovalWatcher(container: HTMLElement, teardown: () => void): void {
  const observerRoot =
    container.closest('.workspace-leaf-content') ??
    container.closest('.workspace-leaf') ??
    document.body;

  const removalWatcher = new MutationObserver(() => {
    if (observerRoot.contains(container)) {
      return;
    }
    removalWatcher.disconnect();
    teardown();
    delete container.dataset.stwWidgetMounted;
  });

  removalWatcher.observe(observerRoot, {
    childList: true,
    subtree: true,
  });
}

export function createWidgetPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el): void => {
    window.setTimeout(() => {
      const projectBlocks = el.querySelectorAll(WIDGET_PROJECT_FENCE_SELECTOR);
      for (let i = 0; i < projectBlocks.length; i++) {
        const code = projectBlocks.item(i);
        if (!(code instanceof HTMLElement)) {
          continue;
        }

        const pre = code.parentElement;
        if (!pre || pre.tagName !== 'PRE') {
          continue;
        }

        mountWidgetProjectBlock({ pre, code, plugin });
      }

      const codeBlocks = el.querySelectorAll(WIDGET_FENCE_SELECTOR);
      for (let i = 0; i < codeBlocks.length; i++) {
        const code = codeBlocks.item(i);
        if (!(code instanceof HTMLElement)) {
          continue;
        }

        const pre = code.parentElement;
        if (!pre || pre.tagName !== 'PRE') {
          continue;
        }

        const type = parseWidgetTypeFromCodeElement(code);
        if (!type) {
          continue;
        }

        mountWidgetBlock({ pre, code, type });
      }
    });
  };
}
