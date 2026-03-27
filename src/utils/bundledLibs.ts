import { decompressFromBase64 } from 'lz-string';
import { BUNDLED_LIBS_LZ_B64 } from '../generated/bundledLibsPayload';

/** Maps loader keys to the same shapes as `import('…')` for each bundled package. */
export type BundledLibModules = {
  ai: typeof import('ai');
  anthropic: typeof import('@ai-sdk/anthropic');
  deepseek: typeof import('@ai-sdk/deepseek');
  google: typeof import('@ai-sdk/google');
  groq: typeof import('@ai-sdk/groq');
  hume: typeof import('@ai-sdk/hume');
  elevenLabs: typeof import('@ai-sdk/elevenlabs');
  ollama: typeof import('ollama-ai-provider-v2');
  openai: typeof import('@ai-sdk/openai');
  openaiCompatible: typeof import('@ai-sdk/openai-compatible');
};

export type BundledLibKey = keyof BundledLibModules;

type BundledLibsRegistry = Record<BundledLibKey, BundledLibModules[BundledLibKey]>;

let registryPromise: Promise<BundledLibsRegistry> | null = null;
const cachedModuleByKey = new Map<BundledLibKey, BundledLibModules[BundledLibKey]>();

function ensureBundledLibsRegistryLoaded(): Promise<BundledLibsRegistry> {
  if (!registryPromise) {
    registryPromise = (async () => {
      const code = decompressFromBase64(BUNDLED_LIBS_LZ_B64);
      if (!code) {
        throw new Error('[Steward] Failed to decompress bundled libs payload');
      }
      (0, eval)(code);
      const registry = (globalThis as unknown as { __stewardBundledLibs?: BundledLibsRegistry })
        .__stewardBundledLibs;
      if (!registry) {
        throw new Error('[Steward] Bundled libs chunk did not define __stewardBundledLibs');
      }
      return registry;
    })();
  }
  return registryPromise;
}

/**
 * Returns the given module from the compressed bundle inside `main.js`.
 * First call decompresses and evaluates the shared chunk; results are cached per key.
 */
export async function getBundledLib<K extends BundledLibKey>(
  key: K
): Promise<BundledLibModules[K]> {
  const fromCache = cachedModuleByKey.get(key);
  if (fromCache !== undefined) {
    return fromCache as BundledLibModules[K];
  }

  const registry = await ensureBundledLibsRegistryLoaded();
  const mod = registry[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled lib key: ${String(key)}`);
  }
  cachedModuleByKey.set(key, mod);
  return mod as BundledLibModules[K];
}
