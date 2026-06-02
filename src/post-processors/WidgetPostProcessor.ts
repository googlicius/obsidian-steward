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
  WIDGET_ACTION_RESULT,
  WIDGET_ACTIONS_REGISTERED,
  WIDGET_APPLY_ACTION,
  WIDGET_RESIZE,
  WIDGET_STATE_SAVE,
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

interface MountIframeOptions {
  extraHead?: string;
  onStateSave?: (state: unknown) => void;
  onActionResult?: (data: {
    requestId: string;
    ok: boolean;
    error?: string;
    state?: unknown;
  }) => void;
  onActionsRegistered?: (actions: string[]) => void;
}

function mountIframe(
  container: HTMLElement,
  type: WidgetType,
  code: string,
  options: MountIframeOptions = {}
): () => void {
  const { srcdoc, sandbox, usesPostMessageResize } = buildWidgetSrcdoc({
    type,
    code,
    extraHead: options.extraHead,
  });

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

  const needsMessageListener =
    usesPostMessageResize ||
    !!options.onStateSave ||
    !!options.onActionResult ||
    !!options.onActionsRegistered;

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) {
      return;
    }

    if (e.data?.type === WIDGET_RESIZE) {
      const h = Number(e.data.height);
      if (Number.isFinite(h) && h > 0) {
        iframe.style.height = `${h}px`;
      }
      return;
    }

    if (e.data?.type === WIDGET_STATE_SAVE && options.onStateSave) {
      options.onStateSave(e.data.state);
      return;
    }

    if (e.data?.type === WIDGET_ACTION_RESULT && options.onActionResult) {
      options.onActionResult({
        requestId: e.data.requestId,
        ok: !!e.data.ok,
        error: typeof e.data.error === 'string' ? e.data.error : undefined,
        state: e.data.state,
      });
      return;
    }

    if (e.data?.type === WIDGET_ACTIONS_REGISTERED && options.onActionsRegistered) {
      const actions = Array.isArray(e.data.actions)
        ? e.data.actions.filter((name: unknown) => typeof name === 'string')
        : [];
      options.onActionsRegistered(actions);
    }
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
  if (needsMessageListener) {
    window.addEventListener('message', onMessage);
  }

  return () => {
    iframe.removeEventListener('load', onLoad);
    if (needsMessageListener) {
      window.removeEventListener('message', onMessage);
    }
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
  let unregisterActionBridge: (() => void) | undefined;

  watchRemoval(container, () => {
    teardownIframe?.();
    unregister?.();
    unregisterActionBridge?.();
    delete container.dataset.stwWidgetMounted;
  });

  try {
    const { widgetService } = plugin;
    const projectPath = parsed.projectPath;

    const buildSrcdoc = async (html: string) => {
      const state = await widgetService.stateService.readState(projectPath);
      return buildWidgetSrcdoc({
        type: 'html',
        code: html,
        extraHead: widgetService.stateService.buildStateHead(state),
      });
    };

    const bundled = await widgetService.bundleProject(projectPath);
    const initialState = await widgetService.stateService.readState(projectPath);

    const refresh = async () => {
      try {
        const next = await widgetService.bundleProject(projectPath);
        const { srcdoc: nextSrcdoc } = await buildSrcdoc(next);
        const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
        if (iframe) {
          iframe.srcdoc = nextSrcdoc;
        }
      } catch (e) {
        logger.error('Failed to refresh widget project:', e);
      }
    };

    unregister = widgetService.registerMountedWidget({
      container,
      projectPath,
      refresh,
    });
    unregisterActionBridge = widgetService.registerActionBridge({
      projectPath,
      sendApplyAction: payload => {
        const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
        iframe?.contentWindow?.postMessage(
          {
            type: WIDGET_APPLY_ACTION,
            action: payload.action,
            params: payload.params,
            requestId: payload.requestId,
          },
          '*'
        );
      },
    });
    teardownIframe = mountIframe(container, 'html', bundled, {
      extraHead: widgetService.stateService.buildStateHead(initialState),
      onStateSave: data => {
        void widgetService.stateService.writeState({ projectPath, data });
      },
      onActionResult: data => {
        widgetService.resolveActionResult(data);
      },
      onActionsRegistered: actions => {
        widgetService.setRegisteredActions(projectPath, actions);
      },
    });
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
