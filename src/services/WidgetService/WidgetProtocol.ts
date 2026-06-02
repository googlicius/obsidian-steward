/** postMessage type: iframe reports its content height to the parent */
export const WIDGET_RESIZE = 'widget-resize';

/** postMessage type: iframe requests persisting widget runtime state to the vault */
export const WIDGET_STATE_SAVE = 'widget-state-save';

/** postMessage type: parent dispatches a registered widget action into the iframe */
export const WIDGET_APPLY_ACTION = 'widget-apply-action';

/** postMessage type: iframe reports the result of a dispatched action */
export const WIDGET_ACTION_RESULT = 'widget-action-result';

/** postMessage type: iframe reports action names registered via window.stw.registerAction */
export const WIDGET_ACTIONS_REGISTERED = 'widget-actions-registered';

/** Max wait (ms) for an iframe to respond to WIDGET_APPLY_ACTION */
export const WIDGET_ACTION_APPLY_TIMEOUT_MS = 5000;

/** Injected global holding the persisted state envelope (or null) */
export const WIDGET_STATE_GLOBAL = '__STW_STATE__';

/** Debounce delay (ms) before posting state saves to the parent */
export const WIDGET_STATE_SAVE_DEBOUNCE_MS = 400;
