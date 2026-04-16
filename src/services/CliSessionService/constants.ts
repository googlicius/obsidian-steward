/**
 * Vault-only HTML comment anchor: insertion point for streamed CLI output inside ```cli-transcript```.
 * One active marker per conversation note (see CliSessionService + CliHandler segment flow).
 */
export const CLI_STREAM_MARKER = '<!--stw-cli-stream-->';

/** The placeholder to process xterm terminal */
export const CLI_XTERM_MARKER = '{{stw-cli-xterm}}';
