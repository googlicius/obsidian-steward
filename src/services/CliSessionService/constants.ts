/**
 * Regex pattern for stream marker placeholders rendered inside ```cli-transcript``` blocks.
 * Supports both active and hidden marker forms.
 */
export const CLI_STREAM_MARKER = '<!--stw-cli-stream(?:-hide)?-->';

export function getCliStreamMarkerPlaceholder(params?: { hidden?: boolean }): string {
  return params?.hidden ? '<!--stw-cli-stream-hide-->' : '<!--stw-cli-stream-->';
}

/** The placeholder to process xterm terminal */
export const CLI_XTERM_MARKER = '{{stw-cli-xterm}}';
