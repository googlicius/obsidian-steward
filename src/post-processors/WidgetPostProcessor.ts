import { MarkdownPostProcessor, normalizePath, Notice } from 'obsidian';
import type StewardPlugin from 'src/main';
import { WidgetSessionService } from 'src/services/WidgetService/WidgetSessionService';
import { getBundledInternal } from 'src/utils/bundledInternals';
import {
  getWidgetFenceLanguage,
  type WidgetType,
  WIDGET_TYPES,
} from 'src/solutions/commands/agents/handlers/ShowWidget';
import {
  WIDGET_PROJECT_FENCE_LANGUAGE,
  buildWidgetSrcdoc,
  WidgetMessageType,
  type WidgetIframeBridgeHandle,
} from 'src/services/WidgetService';
import { logger } from 'src/utils/logger';

const { getTranslation } = getBundledInternal('i18n');

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
  onStateSave?: (payload: { state: unknown; options?: unknown }) => void;
  onStartSession?: () => void;
  onActionResult?: (data: {
    requestId: string;
    ok: boolean;
    error?: string;
    state?: unknown;
  }) => void;
  onQueryResult?: (data: {
    requestId: string;
    ok: boolean;
    error?: string;
    data?: unknown;
  }) => void;
  onActionsRegistered?: (actions: string[]) => void;
  onQueriesRegistered?: (queries: string[]) => void;
  onAssetRequest?: (data: { requestId: string; assetId: string }) => void;
}

interface MountIframeParams {
  container: HTMLElement;
  type: WidgetType;
  source: { mode: 'srcdoc'; code: string } | { mode: 'src'; src: string };
  options?: MountIframeOptions;
}

function mountWidgetIframe(params: MountIframeParams): () => void {
  const options = params.options ?? {};
  let sandbox: string;
  let usesPostMessageResize: boolean;

  const iframe = Object.assign(activeDocument.createElement('iframe'), {
    className: 'stw-widget-frame',
    title: 'Widget',
  });
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('loading', 'lazy');

  if (params.source.mode === 'srcdoc') {
    const {
      srcdoc,
      sandbox: srcdocSandbox,
      usesPostMessageResize: srcdocResize,
    } = buildWidgetSrcdoc({
      type: params.type,
      code: params.source.code,
      extraHead: options.extraHead,
    });
    iframe.srcdoc = srcdoc;
    sandbox = srcdocSandbox;
    usesPostMessageResize = srcdocResize;
  } else {
    iframe.src = params.source.src;
    sandbox = 'allow-scripts allow-same-origin';
    usesPostMessageResize = true;
  }

  iframe.setAttribute('sandbox', sandbox);
  params.container.appendChild(iframe);

  let resizeObserver: ResizeObserver | undefined;

  const syncHeight = () => {
    const doc = iframe.contentDocument;
    const h = Math.max(doc?.documentElement.scrollHeight ?? 0, doc?.body?.scrollHeight ?? 0);
    if (h > 0) iframe.style.height = `${h}px`;
  };

  const needsMessageListener =
    usesPostMessageResize ||
    !!options.onStateSave ||
    !!options.onStartSession ||
    !!options.onActionResult ||
    !!options.onQueryResult ||
    !!options.onActionsRegistered ||
    !!options.onQueriesRegistered ||
    !!options.onAssetRequest;

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) {
      return;
    }

    if (e.data?.type === WidgetMessageType.Resize) {
      const h = Number(e.data.height);
      if (Number.isFinite(h) && h > 0) {
        iframe.style.height = `${h}px`;
      }
      return;
    }

    if (e.data?.type === WidgetMessageType.Log) {
      const message = typeof e.data.message === 'string' ? e.data.message : '[widget]';
      if (e.data.data !== undefined) {
        logger.log(message, e.data.data);
      } else {
        logger.log(message);
      }
      return;
    }

    if (e.data?.type === WidgetMessageType.StateSave && options.onStateSave) {
      options.onStateSave({
        state: e.data.state,
        options: e.data.options && typeof e.data.options === 'object' ? e.data.options : undefined,
      });
      return;
    }

    if (e.data?.type === WidgetMessageType.StartSession && options.onStartSession) {
      options.onStartSession();
      return;
    }

    if (e.data?.type === WidgetMessageType.ActionResult && options.onActionResult) {
      logger.log('[STW widget_action] host received ActionResult', {
        requestId: e.data.requestId,
        ok: !!e.data.ok,
        error: typeof e.data.error === 'string' ? e.data.error : undefined,
      });
      options.onActionResult({
        requestId: e.data.requestId,
        ok: !!e.data.ok,
        error: typeof e.data.error === 'string' ? e.data.error : undefined,
        state: e.data.state,
      });
      return;
    }

    if (e.data?.type === WidgetMessageType.QueryResult && options.onQueryResult) {
      logger.log('[STW widget_query] host received QueryResult', {
        requestId: e.data.requestId,
        ok: !!e.data.ok,
        error: typeof e.data.error === 'string' ? e.data.error : undefined,
      });
      options.onQueryResult({
        requestId: e.data.requestId,
        ok: !!e.data.ok,
        error: typeof e.data.error === 'string' ? e.data.error : undefined,
        data: e.data.data,
      });
      return;
    }

    if (e.data?.type === WidgetMessageType.ActionsRegistered && options.onActionsRegistered) {
      const actions = Array.isArray(e.data.actions)
        ? e.data.actions.filter((name: unknown) => typeof name === 'string')
        : [];
      options.onActionsRegistered(actions);
      return;
    }

    if (e.data?.type === WidgetMessageType.QueriesRegistered && options.onQueriesRegistered) {
      const queries = Array.isArray(e.data.queries)
        ? e.data.queries.filter((name: unknown) => typeof name === 'string')
        : [];
      options.onQueriesRegistered(queries);
      return;
    }

    if (e.data?.type === WidgetMessageType.AssetRequest && options.onAssetRequest) {
      const requestId = typeof e.data.requestId === 'string' ? e.data.requestId : '';
      const assetId = typeof e.data.assetId === 'string' ? e.data.assetId : '';
      if (!requestId || !assetId) {
        return;
      }
      options.onAssetRequest({ requestId, assetId });
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
  const root = container.closest('.workspace-leaf-content, .workspace-leaf') ?? activeDocument.body;
  const observer = new MutationObserver(() => {
    if (root.contains(container)) return;
    observer.disconnect();
    teardown();
    delete container.dataset.stwWidgetMounted;
  });
  observer.observe(root, { childList: true, subtree: true });
}

function makeContainer(type: string): HTMLElement {
  const el = activeDocument.createElement('div');
  el.classList.add('stw-widget-container');
  el.dataset.stwWidgetType = type;
  return el;
}

function mountWidget(pre: HTMLElement, type: WidgetType, code: string): void {
  if (pre.dataset.stwWidgetMounted === '1' || !code.trim()) return;
  pre.dataset.stwWidgetMounted = '1';
  const container = makeContainer(type);
  pre.replaceWith(container);
  watchRemoval(
    container,
    mountWidgetIframe({
      container,
      type,
      source: { mode: 'srcdoc', code },
    })
  );
}

async function mountWidgetProject(
  pre: HTMLElement,
  code: HTMLElement,
  plugin: StewardPlugin,
  sourcePath: string
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
  let unregisterWidgetBridge: (() => void) | undefined;
  let sendApplyAction: WidgetIframeBridgeHandle['sendApplyAction'] | undefined;
  let sendDispatchQuery: WidgetIframeBridgeHandle['sendDispatchQuery'] | undefined;

  watchRemoval(container, () => {
    teardownIframe?.();
    unregister?.();
    unregisterWidgetBridge?.();
    delete container.dataset.stwWidgetMounted;
  });

  try {
    const { widgetService } = plugin;
    const projectPath = parsed.projectPath;
    const def = await widgetService.definitionService.getWidgetDefinition(projectPath);
    const widgetName = def.manifest?.widgetName?.trim() || parsed.widgetId;
    const viewPath = widgetService.getProjectViewPath({
      widgetId: parsed.widgetId,
      widgetName,
    });
    const isDedicatedView = normalizePath(sourcePath) === normalizePath(viewPath);
    const isArtifactView = plugin.widgetService.isArtifactPath(sourcePath);

    const iframeCallbacks: MountIframeOptions = {
      onStateSave: payload => {
        void widgetService.orchestrator.handleStateSave({
          projectPath,
          widgetId: parsed.widgetId,
          incomingData: payload.state,
          saveOptions: WidgetSessionService.parseWidgetStateSaveOptions(payload.options),
          lang: parsed.lang,
        });
      },
      onStartSession: () => {
        void (async () => {
          await widgetService.sessionService.startNewSession({
            projectPath,
            widgetId: parsed.widgetId,
            lang: parsed.lang,
          });
          await refresh();
        })();
      },
      onActionResult: data => {
        widgetService.resolveBridgeMessage('action', data);
      },
      onQueryResult: data => {
        widgetService.resolveBridgeMessage('query', data);
      },
      onActionsRegistered: actions => {
        if (!sendApplyAction) {
          return;
        }
        widgetService.setRegisteredActions({
          projectPath,
          sendApplyAction,
          actions,
        });
      },
      onQueriesRegistered: queries => {
        if (!sendDispatchQuery) {
          return;
        }
        widgetService.setRegisteredQueries({
          projectPath,
          sendDispatchQuery,
          queries,
        });
      },
      onAssetRequest: data => {
        const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
        void widgetService.provideAsset({ projectPath, assetId: data.assetId }).then(result => {
          if (!iframe?.contentWindow) {
            return;
          }

          if (!result.ok) {
            iframe.contentWindow.postMessage(
              {
                type: WidgetMessageType.AssetResponse,
                requestId: data.requestId,
                ok: false,
                error: result.error,
              },
              '*'
            );
            return;
          }

          iframe.contentWindow.postMessage(
            {
              type: WidgetMessageType.AssetResponse,
              requestId: data.requestId,
              ok: true,
              buffer: result.buffer,
              mimeType: result.mimeType,
            },
            '*',
            [result.buffer]
          );
        });
      },
    };

    const buildSrcdoc = async (html: string, assets: Record<string, string>) => {
      const state = await widgetService.stateService.readState(projectPath);
      const actors = await widgetService.definitionService.getIframeActorsConfig(projectPath);
      return buildWidgetSrcdoc({
        type: 'html',
        code: html,
        extraHead: widgetService.stateService.buildStateHead(state, assets, actors),
      });
    };

    const generatedPath = parsed.generatedFile ? normalizePath(parsed.generatedFile) : null;
    const generatedVaultFile = generatedPath ? plugin.app.vault.getFileByPath(generatedPath) : null;
    const usesGeneratedFile = !!generatedVaultFile;

    const refresh = async () => {
      try {
        const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
        if (!iframe) {
          return;
        }

        if (usesGeneratedFile) {
          iframe.contentWindow?.location.reload();
          return;
        }

        const next = await widgetService.bundleProject(projectPath);
        const { srcdoc: nextSrcdoc } = await buildSrcdoc(next.html, next.assets);
        iframe.srcdoc = nextSrcdoc;
      } catch (e) {
        logger.error('Failed to refresh widget project:', e);
      }
    };

    unregister = widgetService.registerMountedWidget({
      container,
      projectPath,
      refresh,
    });
    sendApplyAction = payload => {
      const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
      const hasIframe = !!iframe;
      const hasContentWindow = !!iframe?.contentWindow;
      logger.log('[STW widget_action] postMessage ApplyAction', {
        projectPath,
        requestId: payload.requestId,
        action: payload.action,
        hasIframe,
        hasContentWindow,
      });
      iframe?.contentWindow?.postMessage(
        {
          type: WidgetMessageType.ApplyAction,
          action: payload.action,
          params: payload.params,
          requestId: payload.requestId,
        },
        '*'
      );
    };
    sendDispatchQuery = payload => {
      const iframe = container.querySelector<HTMLIFrameElement>('iframe.stw-widget-frame');
      logger.log('[STW widget_query] postMessage DispatchQuery', {
        projectPath,
        requestId: payload.requestId,
        query: payload.query,
        hasIframe: !!iframe,
        hasContentWindow: !!iframe?.contentWindow,
      });
      iframe?.contentWindow?.postMessage(
        {
          type: WidgetMessageType.DispatchQuery,
          query: payload.query,
          params: payload.params,
          requestId: payload.requestId,
        },
        '*'
      );
    };
    unregisterWidgetBridge = widgetService.registerWidgetBridge({
      projectPath,
      sendApplyAction,
      sendDispatchQuery,
    });

    if (generatedVaultFile) {
      teardownIframe = mountWidgetIframe({
        container,
        type: 'html',
        source: { mode: 'src', src: plugin.app.vault.getResourcePath(generatedVaultFile) },
        options: iframeCallbacks,
      });
    } else {
      const bundled = await widgetService.bundleProject(projectPath);
      const initialState = await widgetService.stateService.readState(projectPath);
      const actors = await widgetService.definitionService.getIframeActorsConfig(projectPath);
      teardownIframe = mountWidgetIframe({
        container,
        type: 'html',
        source: { mode: 'srcdoc', code: bundled.html },
        options: {
          ...iframeCallbacks,
          extraHead: widgetService.stateService.buildStateHead(
            initialState,
            bundled.assets,
            actors
          ),
        },
      });
    }
    if (!isDedicatedView && !isArtifactView) {
      appendWidgetActionLinks(container, plugin, {
        widgetId: parsed.widgetId,
        widgetName,
        projectPath,
        lang: parsed.lang,
      });
    }
  } catch (e) {
    logger.error('Failed to mount widget project:', e);
    container.textContent = 'Failed to load widget project.';
  }
}

function appendWidgetActionLinks(
  container: HTMLElement,
  plugin: StewardPlugin,
  params: {
    widgetId: string;
    widgetName: string;
    projectPath: string;
    lang: string | null;
  }
): void {
  const t = getTranslation(params.lang);
  const smallEl = activeDocument.createElement('small');
  smallEl.classList.add('italic');

  appendActionLink(smallEl, t('common.openInNewTab'), () => {
    void (async () => {
      const filePath = await plugin.widgetService.ensureProjectView({
        widgetId: params.widgetId,
        lang: params.lang,
      });
      await plugin.openReadingViewInNewTab({ filePath });
    })();
  });

  smallEl.appendChild(activeDocument.createTextNode(' · '));

  appendActionLink(smallEl, t('common.saveAsArtifact'), () => {
    void (async () => {
      const filePath = await plugin.widgetService.saveWidgetArtifact({
        widgetId: params.widgetId,
        widgetName: params.widgetName,
        lang: params.lang,
      });
      new Notice(t('common.artifactSaved', { name: params.widgetName }));
      await plugin.openReadingViewInNewTab({ filePath });
    })();
  });

  container.appendChild(smallEl);
}

function appendActionLink(
  parent: HTMLElement,
  label: string,
  onClick: () => void
): HTMLAnchorElement {
  const linkEl = activeDocument.createElement('a');
  linkEl.href = '#';
  linkEl.textContent = label;
  linkEl.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  parent.appendChild(linkEl);
  return linkEl;
}

export function createWidgetPostProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    window.setTimeout(() => {
      el.querySelectorAll<HTMLElement>(WIDGET_PROJECT_FENCE_SELECTOR).forEach(code => {
        const pre = code.parentElement;
        if (pre?.tagName === 'PRE') void mountWidgetProject(pre, code, plugin, ctx.sourcePath);
      });

      el.querySelectorAll<HTMLElement>(WIDGET_FENCE_SELECTOR).forEach(code => {
        const pre = code.parentElement;
        const type = getWidgetType(code);
        if (pre?.tagName === 'PRE' && type) mountWidget(pre, type, code.textContent ?? '');
      });
    });
  };
}
