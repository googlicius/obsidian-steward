import type { WidgetType } from 'src/solutions/commands/agents/handlers/ShowWidget';
import {
  WidgetMessageType,
  WIDGET_ASSET_REQUEST_TIMEOUT_MS,
  WIDGET_STATE_GLOBAL,
  WIDGET_STATE_SAVE_DEBOUNCE_MS,
} from './WidgetProtocol';
import type { WidgetState } from './types';

/** Content-Security-Policy applied to sandboxed widget iframes. */
const WIDGET_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:;";

/** Script injected into widgets to report content height to the parent via postMessage. */
const WIDGET_RESIZE_SCRIPT = `<script>
(function () {
  function reportHeight() {
    var docEl = document.documentElement;
    var body = document.body;
    var height = Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0);
    if (height <= 0) {
      return;
    }
    parent.postMessage({ type: '${WidgetMessageType.Resize}', height: height }, '*');
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

/** Default head markup (charset, CSP, resize script) prepended to bundled widget HTML. */
export const WIDGET_SRCDOC_HEAD = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">${WIDGET_RESIZE_SCRIPT}`;

/**
 * Script injected into project widgets: hydrates persisted state and exposes window.stw for saves.
 */
export function buildWidgetStateHead(params: {
  state: WidgetState | null;
  assets?: Record<string, string>;
}): string {
  const serialized = JSON.stringify(params.state);
  const serializedAssets = JSON.stringify(params.assets ?? {});
  return `<script>
(function () {
  window.${WIDGET_STATE_GLOBAL} = ${serialized};
  var saveTimer;
  var actionHandlers = {};
  var queryHandlers = {};
  var assetRegistry = ${serializedAssets};
  var assetUrlCache = {};
  var pendingAssetRequests = {};
  var assetRequestCounter = 0;
  var ASSET_ATTR_BY_TAG = {
    IMG: 'src',
    AUDIO: 'src',
    VIDEO: 'src',
    SOURCE: 'src',
    TRACK: 'src',
    LINK: 'href',
    EMBED: 'src',
    OBJECT: 'data'
  };

  function stwLog(message, data) {
    parent.postMessage({
      type: '${WidgetMessageType.Log}',
      message: message,
      data: data
    }, '*');
  }

  function notifyRegisteredActions() {
    parent.postMessage({
      type: '${WidgetMessageType.ActionsRegistered}',
      actions: Object.keys(actionHandlers)
    }, '*');
  }

  function notifyRegisteredQueries() {
    parent.postMessage({
      type: '${WidgetMessageType.QueriesRegistered}',
      queries: Object.keys(queryHandlers)
    }, '*');
  }

  function normalizeActionResult(result) {
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
      return result;
    }
    return { ok: true, state: result };
  }

  function normalizeQueryResult(result) {
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
      return result;
    }
    return { ok: true, data: result };
  }

  function resolveRegistryPath(assetId) {
    if (typeof assetId !== 'string' || !assetId) {
      return null;
    }
    var trimmed = assetId.trim();
    if (trimmed.indexOf('asset:') === 0) {
      trimmed = trimmed.slice(6);
    }
    if (assetRegistry[trimmed]) {
      return assetRegistry[trimmed];
    }
    return null;
  }

  function requestAssetBytes(assetId) {
    var registryPath = resolveRegistryPath(assetId);
    if (!registryPath) {
      return Promise.reject(new Error('asset_not_allowed'));
    }

    assetRequestCounter += 1;
    var requestId = 'stw-asset-' + assetRequestCounter;

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete pendingAssetRequests[requestId];
        reject(new Error('asset_request_timeout'));
      }, ${WIDGET_ASSET_REQUEST_TIMEOUT_MS});

      pendingAssetRequests[requestId] = {
        resolve: resolve,
        reject: reject,
        timer: timer
      };

      parent.postMessage({
        type: '${WidgetMessageType.AssetRequest}',
        requestId: requestId,
        assetId: registryPath
      }, '*');
    });
  }

  function createLocalAssetUrl(assetId, buffer, mimeType) {
    var blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    assetUrlCache[assetId] = url;
    return url;
  }

  function hydrateAssetElement(el) {
    var ref = el.getAttribute('data-stw-asset');
    if (!ref) {
      return Promise.resolve();
    }

    var targetAttr = el.getAttribute('data-stw-target-attr') || ASSET_ATTR_BY_TAG[el.tagName] || 'src';
    return window.stw.getAsset(ref).then(function (url) {
      if (!url) {
        return;
      }
      el.setAttribute(targetAttr, url);
      el.removeAttribute('data-stw-asset');
      if (el.hasAttribute('data-stw-target-attr')) {
        el.removeAttribute('data-stw-target-attr');
      }
    });
  }

  function hydrateStyleText(text) {
    var pattern = /url\\(\\s*asset:([^)]+)\\s*\\)/gi;
    var paths = [];
    var seen = {};
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var path = match[1].trim();
      if (!seen[path]) {
        seen[path] = true;
        paths.push(path);
      }
    }

    if (paths.length === 0) {
      return Promise.resolve(text);
    }

    return Promise.all(paths.map(function (path) {
      return window.stw.getAsset(path);
    })).then(function (urls) {
      var index = 0;
      return text.replace(pattern, function () {
        var url = urls[index];
        index += 1;
        if (!url) {
          return 'url(about:blank)';
        }
        return 'url("' + url + '")';
      });
    });
  }

  function hydrateDomAssets() {
    var elements = document.querySelectorAll('[data-stw-asset]');
    var promises = [];
    for (var i = 0; i < elements.length; i++) {
      promises.push(hydrateAssetElement(elements[i]));
    }

    var styleNodes = document.querySelectorAll('style');
    for (var j = 0; j < styleNodes.length; j++) {
      (function (styleEl) {
        var original = styleEl.textContent || '';
        promises.push(
          hydrateStyleText(original).then(function (next) {
            if (next !== original) {
              styleEl.textContent = next;
            }
          })
        );
      })(styleNodes[j]);
    }

    var inlineStyled = document.querySelectorAll('[style*="asset:"]');
    for (var k = 0; k < inlineStyled.length; k++) {
      (function (el) {
        var original = el.getAttribute('style') || '';
        promises.push(
          hydrateStyleText(original).then(function (next) {
            if (next !== original) {
              el.setAttribute('style', next);
            }
          })
        );
      })(inlineStyled[k]);
    }

    return Promise.all(promises);
  }

  window.stw = {
    getState: function () {
      var envelope = window.${WIDGET_STATE_GLOBAL};
      return envelope ? envelope.data : null;
    },
    getSession: function () {
      var envelope = window.${WIDGET_STATE_GLOBAL};
      return envelope && envelope.session ? envelope.session : null;
    },
    setState: function (data, options) {
      window.${WIDGET_STATE_GLOBAL} = { version: 1, data: data };
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        parent.postMessage({
          type: '${WidgetMessageType.StateSave}',
          state: data,
          options: options && typeof options === 'object' ? options : undefined
        }, '*');
      }, ${WIDGET_STATE_SAVE_DEBOUNCE_MS});
    },
    startNewSession: function () {
      parent.postMessage({ type: '${WidgetMessageType.StartSession}' }, '*');
    },
    registerAction: function (name, fn) {
      actionHandlers[name] = fn;
      notifyRegisteredActions();
    },
    registerQuery: function (name, fn) {
      queryHandlers[name] = fn;
      notifyRegisteredQueries();
    },
    dispatchAction: function (name, params) {
      var handler = actionHandlers[name];
      if (!handler) {
        return { ok: false, error: 'unknown_action' };
      }
      try {
        return normalizeActionResult(handler(params || {}));
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : 'action_failed' };
      }
    },
    dispatchQuery: function (name, params) {
      var handler = queryHandlers[name];
      if (!handler) {
        return { ok: false, error: 'unknown_query' };
      }
      try {
        return normalizeQueryResult(handler(params || {}));
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : 'query_failed' };
      }
    },
    getRegisteredActions: function () {
      return Object.keys(actionHandlers);
    },
    assets: assetRegistry,
    getAsset: function (id) {
      if (typeof id !== 'string' || !id) {
        return Promise.resolve(null);
      }

      var registryPath = resolveRegistryPath(id);
      if (!registryPath) {
        return Promise.resolve(null);
      }

      if (assetUrlCache[registryPath]) {
        return Promise.resolve(assetUrlCache[registryPath]);
      }

      return requestAssetBytes(registryPath).then(function (payload) {
        return createLocalAssetUrl(registryPath, payload.buffer, payload.mimeType);
      }).catch(function () {
        return null;
      });
    }
  };

  window.addEventListener('message', function (e) {
    if (!e.data) {
      return;
    }

    if (e.data.type === '${WidgetMessageType.AssetResponse}') {
      var pending = pendingAssetRequests[e.data.requestId];
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      delete pendingAssetRequests[e.data.requestId];
      if (!e.data.ok) {
        pending.reject(new Error(e.data.error || 'asset_request_failed'));
        return;
      }
      pending.resolve({
        buffer: e.data.buffer,
        mimeType: e.data.mimeType
      });
      return;
    }

    if (e.data.type === '${WidgetMessageType.DispatchQuery}') {
      stwLog('[STW widget_query] iframe received DispatchQuery', {
        requestId: e.data.requestId,
        query: e.data.query,
        params: e.data.params
      });

      var queryResult = window.stw.dispatchQuery(e.data.query, e.data.params);
      stwLog('[STW widget_query] iframe dispatchQuery finished', {
        requestId: e.data.requestId,
        query: e.data.query,
        ok: !!(queryResult && queryResult.ok),
        error: queryResult && queryResult.error ? queryResult.error : undefined
      });
      parent.postMessage({
        type: '${WidgetMessageType.QueryResult}',
        requestId: e.data.requestId,
        ok: !!queryResult.ok,
        error: queryResult.error,
        data: queryResult.data
      }, '*');
      return;
    }

    if (e.data.type !== '${WidgetMessageType.ApplyAction}') {
      return;
    }

    stwLog('[STW widget_action] iframe received ApplyAction', {
      requestId: e.data.requestId,
      action: e.data.action,
      params: e.data.params
    });

    var result = window.stw.dispatchAction(e.data.action, e.data.params);
    stwLog('[STW widget_action] iframe dispatchAction finished', {
      requestId: e.data.requestId,
      action: e.data.action,
      ok: !!(result && result.ok),
      error: result && result.error ? result.error : undefined
    });
    parent.postMessage({
      type: '${WidgetMessageType.ActionResult}',
      requestId: e.data.requestId,
      ok: !!result.ok,
      error: result.error,
      state: result.state
    }, '*');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      void hydrateDomAssets();
    });
  } else {
    void hydrateDomAssets();
  }
})();
</script>`;
}

const SCRIPT_TAG_PATTERN = /<script[\s>]/i;

function widgetCodeContainsScript(code: string): boolean {
  return SCRIPT_TAG_PATTERN.test(code);
}

function injectHeadMetaIntoDocument(code: string, extraHead = ''): string {
  const headContent = `${WIDGET_SRCDOC_HEAD}${extraHead}`;
  if (/<head[\s>]/i.test(code)) {
    return code.replace(/<head([\s>])/i, `<head$1${headContent}`);
  }

  if (/<html[\s>]/i.test(code)) {
    return code.replace(/<html([\s>])/i, `<html$1<head>${headContent}</head>`);
  }

  return code;
}

/**
 * Wraps widget HTML or SVG in a full document with CSP, resize reporting, and sandbox attributes.
 */
export function buildWidgetSrcdoc(params: { type: WidgetType; code: string; extraHead?: string }): {
  srcdoc: string;
  sandbox: string;
  usesPostMessageResize: boolean;
} {
  const trimmed = params.code.trim();
  const extraHead = params.extraHead ?? '';

  if (params.type === 'svg') {
    const hasScript = widgetCodeContainsScript(trimmed);
    const headMeta = hasScript
      ? `${WIDGET_SRCDOC_HEAD}${extraHead}`
      : `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">${extraHead}`;
    return {
      srcdoc: `<!DOCTYPE html><html><head>${headMeta}</head><body style="margin:0;">${trimmed}</body></html>`,
      sandbox: hasScript ? 'allow-scripts' : 'allow-same-origin',
      usesPostMessageResize: hasScript,
    };
  }

  const isFullDocument = /^<!DOCTYPE/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
  if (isFullDocument) {
    return {
      srcdoc: injectHeadMetaIntoDocument(trimmed, extraHead),
      sandbox: 'allow-scripts',
      usesPostMessageResize: true,
    };
  }

  return {
    srcdoc: `<!DOCTYPE html><html><head>${WIDGET_SRCDOC_HEAD}${extraHead}</head><body>${trimmed}</body></html>`,
    sandbox: 'allow-scripts',
    usesPostMessageResize: true,
  };
}
