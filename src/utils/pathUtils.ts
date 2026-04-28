/**
 * Per-segment URI encoding for short `@vault/path` references so a single
 * document token can represent paths that contain spaces (e.g. `My%20Note.md`).
 */
export function encodePath(vaultPath: string): string {
  return vaultPath
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * Reverses {@link encodePath}.
 */
export function decodePath(encodedPath: string): string {
  return encodedPath
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join('/');
}

/**
 * Check if a path is hidden from Obsidian vault
 * by checking if the name or any folder starts with dot
 */
export function isHiddenPath(path: string) {
  const parts = path.split('/');

  return parts.some(part => part.startsWith('.'));
}
