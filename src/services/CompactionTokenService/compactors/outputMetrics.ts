/**
 * Serialized size of a tool result payload (character length of JSON/text), for compacted metadata.
 */
export function measureSerializedOutputSize(output: unknown): number {
  if (output === undefined || output === null) {
    return 0;
  }
  if (typeof output === 'string') {
    return output.length;
  }
  if (
    typeof output === 'number' ||
    typeof output === 'boolean' ||
    typeof output === 'bigint' ||
    typeof output === 'symbol'
  ) {
    return String(output).length;
  }
  try {
    return JSON.stringify(output).length;
  } catch {
    return 0;
  }
}
