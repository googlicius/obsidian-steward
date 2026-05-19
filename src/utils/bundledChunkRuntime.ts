/**
 * Shared runtime for decompressed bundled chunks.
 */

type GlobalWithChunks = typeof globalThis & Record<string, unknown>;

function getBundledChunkGlobal(): GlobalWithChunks {
  if (typeof window !== 'undefined') {
    return window as unknown as GlobalWithChunks;
  }
  return globalThis as unknown as GlobalWithChunks;
}

/**
 * @param pluginRequire  Pass the plugin's local `require` when the chunk contains
 *   external modules resolved by Obsidian's loader (e.g. `"obsidian"`).
 *   The global `window.require` is Electron's native one and cannot resolve them.
 */
export function runBundledChunk(code: string, context: string, pluginRequire?: NodeRequire): void {
  const g = getBundledChunkGlobal();
  const savedRequire = g['require'];
  try {
    if (pluginRequire) {
      g['require'] = pluginRequire;
    }
    g.eval.call(g, code);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`[Steward] Failed to execute bundled chunk (${context}): ${msg}`);
  } finally {
    if (pluginRequire) {
      g['require'] = savedRequire;
    }
  }
}

export function readBundledChunkGlobal<T>(key: string, context: string): T {
  const g = getBundledChunkGlobal();
  const raw = g[key] as T | undefined;
  if (!raw) {
    throw new Error(`[Steward] Bundled chunk did not define ${key} (${context})`);
  }
  return raw;
}

export function unwrapBundledRegistry<T extends object>(raw: unknown): T {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[Steward] Bundled registry is missing or invalid');
  }
  const d = (raw as { default?: unknown }).default;
  if (d !== undefined && d !== null && typeof d === 'object') {
    return d as T;
  }
  return raw as T;
}
