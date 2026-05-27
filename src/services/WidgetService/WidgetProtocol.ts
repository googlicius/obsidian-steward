import type { WidgetManifest } from './types';

/** postMessage type: iframe reports its content height to the parent */
export const WIDGET_RESIZE = 'widget-resize';

/** postMessage type: iframe asks the parent for a vault asset */
export const WIDGET_REQUEST_ASSET = 'widget-request-asset';

/** postMessage type: parent delivers a vault asset to the iframe */
export const WIDGET_ASSET = 'widget-asset';

export interface WidgetRequestAssetPayload {
  type: typeof WIDGET_REQUEST_ASSET;
  widgetId: string;
  key: string;
  requestId: string;
}

export interface WidgetAssetPayload {
  type: typeof WIDGET_ASSET;
  requestId: string;
  key: string;
  payload: unknown;
  error?: string;
}

export const WIDGET_ASSET_BRIDGE_SCRIPT = `<script>
(function () {
  var pending = {};
  window.__widgetRequestAsset = function (key) {
    return new Promise(function (resolve, reject) {
      var requestId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      pending[requestId] = { resolve: resolve, reject: reject };
      parent.postMessage({
        type: '${WIDGET_REQUEST_ASSET}',
        widgetId: window.__WIDGET_ID__ || '',
        key: key,
        requestId: requestId
      }, '*');
      setTimeout(function () {
        if (pending[requestId]) {
          delete pending[requestId];
          reject(new Error('Asset request timed out: ' + key));
        }
      }, 15000);
    });
  };
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== '${WIDGET_ASSET}') {
      return;
    }
    var entry = pending[data.requestId];
    if (!entry) {
      return;
    }
    delete pending[data.requestId];
    if (data.error) {
      entry.reject(new Error(data.error));
      return;
    }
    entry.resolve(data.payload);
  });
})();
</script>`;

export function buildWidgetBridgeHead(widgetId: string): string {
  return `<script>window.__WIDGET_ID__ = ${JSON.stringify(widgetId)};</script>${WIDGET_ASSET_BRIDGE_SCRIPT}`;
}

export function isRuntimeAssetKey(manifest: WidgetManifest | null, key: string): boolean {
  if (!manifest?.assets) {
    return false;
  }
  return key in manifest.assets;
}
