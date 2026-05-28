import type { WidgetType } from 'src/solutions/commands/agents/handlers/ShowWidget';
import { WIDGET_RESIZE } from './WidgetProtocol';

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
