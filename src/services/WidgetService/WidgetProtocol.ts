/** postMessage types exchanged between widget iframes and the host. */
export enum WidgetMessageType {
  /** iframe reports its content height to the parent */
  Resize = 'widget-resize',
  /** iframe requests persisting widget runtime state to the vault */
  StateSave = 'widget-state-save',
  /** parent dispatches a registered widget action into the iframe */
  ApplyAction = 'widget-apply-action',
  /** iframe reports the result of a dispatched action */
  ActionResult = 'widget-action-result',
  /** iframe reports action names registered via window.stw.registerAction */
  ActionsRegistered = 'widget-actions-registered',
  /** iframe requests binary data for a manifest-listed asset */
  AssetRequest = 'widget-asset-request',
  /** host returns asset bytes (or error) for a prior asset request */
  AssetResponse = 'widget-asset-response',
}

/** Max wait (ms) for an iframe to respond to WidgetMessageType.ApplyAction */
export const WIDGET_ACTION_APPLY_TIMEOUT_MS = 5000;

/** Max wait (ms) for the host to respond to WidgetMessageType.AssetRequest */
export const WIDGET_ASSET_REQUEST_TIMEOUT_MS = 30000;

/** Injected global holding the persisted state envelope (or null) */
export const WIDGET_STATE_GLOBAL = '__STW_STATE__';

/** Debounce delay (ms) before posting state saves to the parent */
export const WIDGET_STATE_SAVE_DEBOUNCE_MS = 400;
