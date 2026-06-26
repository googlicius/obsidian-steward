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
  /** parent dispatches a registered read-only query into the iframe */
  DispatchQuery = 'widget-dispatch-query',
  /** iframe reports the result of a dispatched query */
  QueryResult = 'widget-query-result',
  /** iframe reports action names registered via window.stw.registerAction */
  ActionsRegistered = 'widget-actions-registered',
  /** iframe reports query names registered via window.stw.registerQuery */
  QueriesRegistered = 'widget-queries-registered',
  /** iframe requests starting a new widget game session */
  StartSession = 'widget-start-session',
  /** iframe requests binary data for a manifest-listed asset */
  AssetRequest = 'widget-asset-request',
  /** host returns asset bytes (or error) for a prior asset request */
  AssetResponse = 'widget-asset-response',
  /** iframe forwards debug log lines to the host logger */
  Log = 'widget-log',
}

/** Max wait (ms) for an iframe to respond to WidgetMessageType.ApplyAction */
export const WIDGET_ACTION_APPLY_TIMEOUT_MS = 5000;

/** Max wait (ms) for the host to respond to WidgetMessageType.AssetRequest */
export const WIDGET_ASSET_REQUEST_TIMEOUT_MS = 30000;

/** Injected global holding the persisted state envelope (or null) */
export const WIDGET_STATE_GLOBAL = '__STW_STATE__';

/** Injected global holding read-only actors roster from Widget.md (or null) */
export const WIDGET_ACTORS_GLOBAL = '__STW_ACTORS__';

/** Debounce delay (ms) before posting state saves to the parent */
export const WIDGET_STATE_SAVE_DEBOUNCE_MS = 400;

/** saveOptions.source set automatically when setState runs inside dispatchAction (widget_action). */
export const WIDGET_STATE_SAVE_SOURCE_MODEL_DISPATCH = 'model_dispatch';
