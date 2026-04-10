import { uniqueID } from 'src/utils/uniqueID';

/** Prefix for the HTML comment anchor used in vault text (insertion point for streamed CLI output). */
export const CLI_STREAM_MARKER_PREFIX = '<!--stw-cli-stream:';

/** Matches a full stream marker comment (5-character base-36 id). */
export const CLI_STREAM_MARKER_REGEX = /<!--stw-cli-stream:[a-z0-9]+-->/;

export function buildCliStreamMarker(): string {
  return `${CLI_STREAM_MARKER_PREFIX}${uniqueID()}-->`;
}
