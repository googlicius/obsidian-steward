import { decompressFromBase64 } from 'lz-string';
import { BUNDLED_DESKTOP_LIBS_LZ_B64 } from '../generated/bundledDesktopLibsPayload';
import { BUNDLED_LIBS_LZ_B64 } from '../generated/bundledLibsPayload';
import type { BundledLibs } from 'src/bundled-libs-entry';
import type { BundledDesktopLibs } from 'src/bundled-libs-desktop-entry';

/**
 * esbuild IIFE + `export default` yields an interop object on `globalThis`:
 * `{ __esModule: true, default: <actual registry> }`.
 */
function unwrapBundledRegistry<T extends object>(raw: unknown): T {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[Steward] Bundled registry is missing or invalid');
  }
  const d = (raw as { default?: unknown }).default;
  if (d !== undefined && d !== null && typeof d === 'object') {
    return d as T;
  }
  return raw as T;
}

type BundledLibKey = keyof BundledLibs;

type BundledLibsRegistry = Record<BundledLibKey, BundledLibs[BundledLibKey]>;

let registryPromise: Promise<BundledLibsRegistry> | null = null;

function ensureBundledLibsRegistryLoaded(): Promise<BundledLibsRegistry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const code = decompressFromBase64(BUNDLED_LIBS_LZ_B64);
      if (!code) {
        throw new Error('[Steward] Failed to decompress bundled libs payload');
      }
      (0, eval)(code);
      const raw = (globalThis as unknown as { __stewardBundledLibs?: unknown }).__stewardBundledLibs;
      if (!raw) {
        throw new Error('[Steward] Bundled libs chunk did not define __stewardBundledLibs');
      }
      return unwrapBundledRegistry<BundledLibsRegistry>(raw);
    })();
  }
  return registryPromise;
}

export type BundledDesktopLibKey = keyof BundledDesktopLibs;

type BundledDesktopLibsRegistry = Record<
  BundledDesktopLibKey,
  BundledDesktopLibs[BundledDesktopLibKey]
>;

let desktopRegistryPromise: Promise<BundledDesktopLibsRegistry> | null = null;

function ensureBundledDesktopLibsRegistryLoaded(): Promise<BundledDesktopLibsRegistry> {
  if (!desktopRegistryPromise) {
    desktopRegistryPromise = (async () => {
      const code = decompressFromBase64(BUNDLED_DESKTOP_LIBS_LZ_B64);
      if (!code) {
        throw new Error('[Steward] Failed to decompress bundled desktop libs payload');
      }
      (0, eval)(code);
      const raw = (globalThis as unknown as { __stewardBundledDesktopLibs?: unknown })
        .__stewardBundledDesktopLibs;
      if (!raw) {
        throw new Error(
          '[Steward] Bundled desktop libs chunk did not define __stewardBundledDesktopLibs'
        );
      }
      return unwrapBundledRegistry<BundledDesktopLibsRegistry>(raw);
    })();
  }
  return desktopRegistryPromise;
}

/**
 * Returns the given module from the compressed bundle inside `main.js`.
 * The first load decompresses and evaluates the shared chunk; the same registry is reused afterward.
 */
export async function getBundledLib<K extends BundledLibKey>(key: K): Promise<BundledLibs[K]> {
  const registry = await ensureBundledLibsRegistryLoaded();
  const mod = registry[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled lib key: ${String(key)}`);
  }
  return mod as BundledLibs[K];
}

/**
 * Returns a desktop-only bundled module (PTY companion, etc.) from the separate eval chunk.
 */
export async function getBundledDesktopLib<K extends BundledDesktopLibKey>(
  key: K
): Promise<BundledDesktopLibs[K]> {
  const registry = await ensureBundledDesktopLibsRegistryLoaded();
  const mod = registry[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled desktop lib key: ${String(key)}`);
  }
  return mod as BundledDesktopLibs[K];
}
