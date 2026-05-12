import { decompressFromBase64 } from 'lz-string';
import type { BundledInternals } from '../../internal/bundled-internals-entry';
import { BUNDLED_INTERNALS_LZ_B64 } from '../generated/bundledInternalsPayload';

type BundledInternalsRegistry = {
  [K in keyof BundledInternals]: BundledInternals[K];
};

let registry: BundledInternalsRegistry | null = null;

function unwrapBundledRegistry<T extends object>(raw: unknown): T {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[Steward] Bundled internals registry is missing or invalid');
  }
  const d = (raw as { default?: unknown }).default;
  if (d !== undefined && d !== null && typeof d === 'object') {
    return d as T;
  }
  return raw as T;
}

/**
 * Decompresses and evaluates the internals chunk once. Synchronous so plugin getters can stay sync.
 */
export function ensureBundledInternalsLoadedSync(): BundledInternalsRegistry {
  if (!registry) {
    const t0 = performance.now();
    const code = decompressFromBase64(BUNDLED_INTERNALS_LZ_B64);
    const decompressMs = performance.now() - t0;
    if (!code) {
      throw new Error('[Steward] Failed to decompress bundled internals payload');
    }
    const runChunk = new Function(
      'require',
      `${code}
return __stewardBundledInternals;`
    );
    const t1 = performance.now();
    const raw = runChunk(require);
    const evalMs = performance.now() - t1;
    const totalMs = performance.now() - t0;
    if (!raw) {
      throw new Error('[Steward] Bundled internals chunk did not produce a registry');
    }
    registry = unwrapBundledRegistry<BundledInternalsRegistry>(raw);
    console.info('[Steward] Bundled internals timing (first load)', {
      decompressMs: Number(decompressMs.toFixed(2)),
      parseEvalMs: Number(evalMs.toFixed(2)),
      totalMs: Number(totalMs.toFixed(2)),
      source: 'ensureBundledInternalsLoadedSync',
    });
  }
  return registry;
}

export function getBundledInternal<K extends keyof BundledInternals>(key: K): BundledInternals[K] {
  const r = ensureBundledInternalsLoadedSync();
  const mod = r[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled internal key: ${String(key)}`);
  }
  return mod as BundledInternals[K];
}
