import type { WidgetType } from 'src/solutions/commands/agents/handlers/ShowWidget';
import {
  WIDGET_ACTION_RESULT,
  WIDGET_ACTIONS_REGISTERED,
  WIDGET_APPLY_ACTION,
  WIDGET_RESIZE,
  WIDGET_STATE_GLOBAL,
  WIDGET_STATE_SAVE,
  WIDGET_STATE_SAVE_DEBOUNCE_MS,
} from './WidgetProtocol';
import type { WidgetState } from './types';

/** Content-Security-Policy applied to sandboxed widget iframes. */
export const WIDGET_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; media-src data:;";

/** Script injected into widgets to report content height to the parent via postMessage. */
export const WIDGET_RESIZE_SCRIPT = `<script>
(function () {
  function reportHeight() {
    var docEl = document.documentElement;
    var body = document.body;
    var height = Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0);
    if (height <= 0) {
      return;
    }
    parent.postMessage({ type: '${WIDGET_RESIZE}', height: height }, '*');
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
export function buildWidgetStateHead(state: WidgetState | null): string {
  const serialized = JSON.stringify(state);
  return `<script>
(function () {
  window.${WIDGET_STATE_GLOBAL} = ${serialized};
  var saveTimer;
  var actionHandlers = {};
  function notifyRegisteredActions() {
    parent.postMessage({
      type: '${WIDGET_ACTIONS_REGISTERED}',
      actions: Object.keys(actionHandlers)
    }, '*');
  }
  function normalizeActionResult(result) {
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
      return result;
    }
    return { ok: true, state: result };
  }
  window.stw = {
    getState: function () {
      var envelope = window.${WIDGET_STATE_GLOBAL};
      return envelope ? envelope.data : null;
    },
    setState: function (data) {
      window.${WIDGET_STATE_GLOBAL} = { version: 1, data: data };
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        parent.postMessage({ type: '${WIDGET_STATE_SAVE}', state: data }, '*');
      }, ${WIDGET_STATE_SAVE_DEBOUNCE_MS});
    },
    registerAction: function (name, fn) {
      actionHandlers[name] = fn;
      notifyRegisteredActions();
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
    getRegisteredActions: function () {
      return Object.keys(actionHandlers);
    }
  };
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== '${WIDGET_APPLY_ACTION}') {
      return;
    }
    var result = window.stw.dispatchAction(e.data.action, e.data.params);
    parent.postMessage({
      type: '${WIDGET_ACTION_RESULT}',
      requestId: e.data.requestId,
      ok: !!result.ok,
      error: result.error,
      state: result.state
    }, '*');
  });
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
