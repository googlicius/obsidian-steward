import { MarkdownPostProcessor } from 'obsidian';
import type StewardPlugin from 'src/main';
import {
  getWidgetFenceLanguage,
  type WidgetType,
  WIDGET_TYPES,
} from 'src/solutions/commands/agents/handlers/ShowWidget';

const WIDGET_FENCE_SELECTOR = WIDGET_TYPES.map(
  type => `pre > code.language-${getWidgetFenceLanguage(type)}`
).join(',');

const WIDGET_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; media-src data:;";

const WIDGET_RESIZE_SCRIPT = `<script>
(function () {
  function reportHeight() {
    var docEl = document.documentElement;
    var body = document.body;
    var height = Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0);
    if (height <= 0) {
      return;
    }
    parent.postMessage({ type: 'stw-widget-resize', height: height }, '*');
  }
  window.addEventListener('load', reportHeight);
  if (typeof ResizeObserver !== 'undefined') {
    var observer = new ResizeObserver(reportHeight);
    if (document.body) {
      observer.observe(document.body);
    }
    observer.observe(document.documentElement);
  }
})();
</script>`;

const WIDGET_SRCDOC_HEAD = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">${WIDGET_RESIZE_SCRIPT}`;

const STW_WIDGET_RESIZE_MESSAGE = 'stw-widget-resize';

const SCRIPT_TAG_PATTERN = /<script[\s>]/i;

function parseWidgetTypeFromCodeElement(code: HTMLElement): WidgetType | null {
  for (let i = 0; i < WIDGET_TYPES.length; i++) {
    const type = WIDGET_TYPES[i];
    if (code.classList.contains(`language-${getWidgetFenceLanguage(type)}`)) {
      return type;
    }
  }
  return null;
}

function widgetCodeContainsScript(code: string): boolean {
  return SCRIPT_TAG_PATTERN.test(code);
}

function injectHeadMetaIntoDocument(code: string): string {
  if (/<head[\s>]/i.test(code)) {
    return code.replace(/<head([\s>])/i, `<head$1${WIDGET_SRCDOC_HEAD}`);
  }

  if (/<html[\s>]/i.test(code)) {
    return code.replace(/<html([\s>])/i, `<html$1<head>${WIDGET_SRCDOC_HEAD}</head>`);
  }

  return code;
}

function buildWidgetSrcdoc(params: { type: WidgetType; code: string }): {
  srcdoc: string;
  sandbox: string;
  usesPostMessageResize: boolean;
} {
  const trimmed = params.code.trim();

  if (params.type === 'svg') {
    const hasScript = widgetCodeContainsScript(trimmed);
    return {
      srcdoc: `<!DOCTYPE html><html><head>${hasScript ? WIDGET_SRCDOC_HEAD : `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`}</head><body style="margin:0;">${trimmed}</body></html>`,
      sandbox: hasScript ? 'allow-scripts' : 'allow-same-origin',
      usesPostMessageResize: hasScript,
    };
  }

  const isFullDocument = /^<!DOCTYPE/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
  if (isFullDocument) {
    return {
      srcdoc: injectHeadMetaIntoDocument(trimmed),
      sandbox: 'allow-scripts',
      usesPostMessageResize: true,
    };
  }

  return {
    srcdoc: `<!DOCTYPE html><html><head>${WIDGET_SRCDOC_HEAD}</head><body>${trimmed}</body></html>`,
    sandbox: 'allow-scripts',
    usesPostMessageResize: true,
  };
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
  iframe.title = 'Steward widget';
  iframe.srcdoc = srcdoc;

  params.container.appendChild(iframe);

  let resizeObserver: ResizeObserver | undefined;

  const onResizeMessage = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) {
      return;
    }
    if (event.data?.type !== STW_WIDGET_RESIZE_MESSAGE) {
      return;
    }
    const height = Number(event.data.height);
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    iframe.style.height = `${height}px`;
  };

  if (usesPostMessageResize) {
    window.addEventListener('message', onResizeMessage);
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
      window.removeEventListener('message', onResizeMessage);
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

export function createWidgetPostProcessor(_plugin: StewardPlugin): MarkdownPostProcessor {
  return (el): void => {
    window.setTimeout(() => {
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
