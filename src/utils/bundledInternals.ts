import { decompressFromBase64 } from 'lz-string';
import type { BundledInternals } from '../../internal/bundled-internals-entry';
import { BUNDLED_INTERNALS_LZ_B64 } from '../generated/bundledInternalsPayload';
import {
  readBundledChunkGlobal,
  runBundledChunk,
  unwrapBundledRegistry,
} from './bundledChunkRuntime';

type BundledInternalsRegistry = {
  [K in keyof BundledInternals]: BundledInternals[K];
};

let registry: BundledInternalsRegistry | null = null;

/**
 * Decompresses and evaluates the internals chunk once. Synchronous so plugin getters can stay sync.
 */
export function ensureBundledInternalsLoadedSync(): BundledInternalsRegistry {
  if (registry) {
    return registry;
  }

  const code = decompressFromBase64(BUNDLED_INTERNALS_LZ_B64);
  if (!code) {
    throw new Error('[Steward] Failed to decompress bundled internals payload');
  }

  runBundledChunk(code, 'bundled-internals', require);
  const raw = readBundledChunkGlobal<unknown>('__stewardBundledInternals', 'bundled-internals');

  registry = unwrapBundledRegistry<BundledInternalsRegistry>(raw);

  return registry;
}

export function getBundledInternal<K extends keyof BundledInternals>(key: K): BundledInternals[K] {
  const r = ensureBundledInternalsLoadedSync();
  const mod = r[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled internal key: ${String(key)}`);
  }
  return mod;
}
