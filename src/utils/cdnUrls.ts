const CDN_URLS = {
  ai: 'https://cdn.jsdelivr.net/npm/ai@6.0.5/+esm',
  anthropic: 'https://cdn.jsdelivr.net/npm/@ai-sdk/anthropic@3.0.33/+esm',
  deepseek: 'https://cdn.jsdelivr.net/npm/@ai-sdk/deepseek@2.0.15/+esm',
  google: 'https://cdn.jsdelivr.net/npm/@ai-sdk/google@3.0.18/+esm',
  groq: 'https://cdn.jsdelivr.net/npm/@ai-sdk/groq@3.0.19/+esm',
  hume: 'https://cdn.jsdelivr.net/npm/@ai-sdk/hume@2.0.15/+esm',
  elevenLabs: 'https://cdn.jsdelivr.net/npm/@ai-sdk/elevenlabs@2.0.15/+esm',
  ollama: 'https://cdn.jsdelivr.net/npm/ollama-ai-provider-v2@3.0.3/+esm',
  openai: 'https://cdn.jsdelivr.net/npm/@ai-sdk/openai@3.0.23/+esm',
  openaiCompatible: 'https://cdn.jsdelivr.net/npm/@ai-sdk/openai-compatible@2.0.24/+esm',
} as const;

type CdnLibTypeMap = {
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

const cached = new Map();
const loadingPromises = new Map();

/**
 * Get library from CDN
 * @param key - The key of the library to get
 * @returns The library matching the given key
 */
export async function getCdnLib<K extends keyof typeof CDN_URLS>(
  key: K
): Promise<CdnLibTypeMap[K]> {
  const cachedLib = cached.get(key);
  if (cachedLib !== undefined) {
    return cachedLib;
  }

  // Prevent multiple concurrent loads
  const existingPromise = loadingPromises.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const loadingPromise = import(CDN_URLS[key]);
  loadingPromises.set(key, loadingPromise);

  try {
    const lib = await loadingPromise;
    cached.set(key, lib);
    return lib;
  } finally {
    loadingPromises.delete(key);
  }
}
