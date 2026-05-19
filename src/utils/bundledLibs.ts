import { decompressFromBase64 } from 'lz-string';
import { BUNDLED_DESKTOP_LIBS_LZ_B64 } from '../generated/bundledDesktopLibsPayload';
import { BUNDLED_LIBS_LZ_B64 } from '../generated/bundledLibsPayload';
import { BUNDLED_SYNC_LIBS_LZ_B64 } from '../generated/bundledSyncLibsPayload';
import type { BundledLibs } from 'src/bundled-libs-entry';
import type { BundledDesktopLibs } from 'src/bundled-libs-desktop-entry';
import type { BundledSyncLibs } from 'src/bundled-libs-sync-entry';
import {
  readBundledChunkGlobal,
  runBundledChunk,
  unwrapBundledRegistry,
} from './bundledChunkRuntime';

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
      runBundledChunk(code, 'bundled-libs');
      const raw = readBundledChunkGlobal<unknown>('__stewardBundledLibs', 'bundled-libs');
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
      runBundledChunk(code, 'bundled-desktop-libs');
      const raw = readBundledChunkGlobal<unknown>(
        '__stewardBundledDesktopLibs',
        'bundled-desktop-libs'
      );
      return unwrapBundledRegistry<BundledDesktopLibsRegistry>(raw);
    })();
  }
  return desktopRegistryPromise;
}

export type BundledSyncLibKey = keyof BundledSyncLibs;

type BundledSyncLibsRegistry = Record<BundledSyncLibKey, BundledSyncLibs[BundledSyncLibKey]>;

let syncRegistry: BundledSyncLibsRegistry | null = null;

function ensureBundledSyncLibsRegistryLoadedSync(): BundledSyncLibsRegistry {
  if (syncRegistry) {
    return syncRegistry;
  }

  const code = decompressFromBase64(BUNDLED_SYNC_LIBS_LZ_B64);
  if (!code) {
    throw new Error('[Steward] Failed to decompress bundled sync libs payload');
  }

  runBundledChunk(code, 'bundled-sync-libs');
  const raw = readBundledChunkGlobal<unknown>('__stewardBundledSyncLibs', 'bundled-sync-libs');

  syncRegistry = unwrapBundledRegistry<BundledSyncLibsRegistry>(raw);
  return syncRegistry;
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
 * Returns a desktop-only bundled module (PTY companion, etc.) from the separate compressed chunk.
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

export function getBundledSyncLibSync<K extends BundledSyncLibKey>(key: K): BundledSyncLibs[K] {
  const registry = ensureBundledSyncLibsRegistryLoadedSync();
  const mod = registry[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled sync lib key: ${String(key)}`);
  }
  return mod as BundledSyncLibs[K];
}
