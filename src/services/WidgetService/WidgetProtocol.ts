/** postMessage type: iframe reports its content height to the parent */
export const WIDGET_RESIZE = 'widget-resize';

/** postMessage type: iframe requests persisting widget runtime state to the vault */
export const WIDGET_STATE_SAVE = 'widget-state-save';

/** Runtime state file name inside a widget project folder */
export const WIDGET_STATE_FILE = 'state.json';

/** Injected global holding the persisted state envelope (or null) */
export const WIDGET_STATE_GLOBAL = '__STW_STATE__';

/** Debounce delay (ms) before posting state saves to the parent */
export const WIDGET_STATE_SAVE_DEBOUNCE_MS = 400;
