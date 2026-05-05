import { decompressFromBase64 } from 'lz-string';
import { BUNDLED_DESKTOP_LIBS_LZ_B64 } from '../generated/bundledDesktopLibsPayload';
import { BUNDLED_LIBS_LZ_B64 } from '../generated/bundledLibsPayload';

/** Maps loader keys to the same shapes as `import('…')` for each bundled package. */
export type BundledLibModules = {
  ai: typeof import('ai');
  anthropic: typeof import('@ai-sdk/anthropic');
  google: typeof import('@ai-sdk/google');
  hume: typeof import('@ai-sdk/hume');
  elevenLabs: typeof import('@ai-sdk/elevenlabs');
  ollama: typeof import('ollama-ai-provider-v2');
  openai: typeof import('@ai-sdk/openai');
  openaiCompatible: typeof import('@ai-sdk/openai-compatible');
  mcp: typeof import('@ai-sdk/mcp');
  xterm: typeof import('@xterm/xterm');
  xtermAddonSerialize: typeof import('@xterm/addon-serialize');
  xtermAddonFit: typeof import('@xterm/addon-fit');
  socketIoClient: typeof import('socket.io-client');
  stripAnsi: typeof import('strip-ansi');
  mustache: typeof import('mustache');
};

export type BundledLibKey = keyof BundledLibModules;

type BundledLibsRegistry = Record<BundledLibKey, BundledLibModules[BundledLibKey]>;

let registryPromise: Promise<BundledLibsRegistry> | null = null;

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

/** Desktop-only bundled modules (`src/bundled-libs-desktop-entry.ts`). */
export type BundledDesktopLibModules = {
  nodePty: typeof import('node-pty');
  socketIo: typeof import('socket.io');
};

export type BundledDesktopLibKey = keyof BundledDesktopLibModules;

type BundledDesktopLibsRegistry = Record<
  BundledDesktopLibKey,
  BundledDesktopLibModules[BundledDesktopLibKey]
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
      const registry = (
        globalThis as unknown as { __stewardBundledDesktopLibs?: BundledDesktopLibsRegistry }
      ).__stewardBundledDesktopLibs;
      if (!registry) {
        throw new Error(
          '[Steward] Bundled desktop libs chunk did not define __stewardBundledDesktopLibs'
        );
      }
      return registry;
    })();
  }
  return desktopRegistryPromise;
}

/**
 * Returns the given module from the compressed bundle inside `main.js`.
 * The first load decompresses and evaluates the shared chunk; the same registry is reused afterward.
 */
export async function getBundledLib<K extends BundledLibKey>(
  key: K
): Promise<BundledLibModules[K]> {
  const registry = await ensureBundledLibsRegistryLoaded();
  const mod = registry[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled lib key: ${String(key)}`);
  }
  return mod as BundledLibModules[K];
}

/**
 * Returns a desktop-only bundled module (PTY companion, etc.) from the separate eval chunk.
 */
export async function getBundledDesktopLib<K extends BundledDesktopLibKey>(
  key: K
): Promise<BundledDesktopLibModules[K]> {
  const registry = await ensureBundledDesktopLibsRegistryLoaded();
  const mod = registry[key];
  if (mod === undefined) {
    throw new Error(`[Steward] Missing bundled desktop lib key: ${String(key)}`);
  }
  return mod as BundledDesktopLibModules[K];
}
