/**
 * Bundled separately by scripts/build-bundled-libs.mjs, compressed, and loaded at runtime
 * so the main bundle does not parse/execute these dependencies at plugin startup.
 */
import * as ai from 'ai';
import * as anthropic from '@ai-sdk/anthropic';
import * as deepseek from '@ai-sdk/deepseek';
import * as elevenlabs from '@ai-sdk/elevenlabs';
import * as google from '@ai-sdk/google';
import * as groq from '@ai-sdk/groq';
import * as hume from '@ai-sdk/hume';
import * as ollama from 'ollama-ai-provider-v2';
import * as openai from '@ai-sdk/openai';
import * as mcp from '@ai-sdk/mcp';
import * as openaiCompatible from '@ai-sdk/openai-compatible';

export type StewardBundledLibsRegistry = {
  ai: typeof ai;
  anthropic: typeof anthropic;
  deepseek: typeof deepseek;
  elevenLabs: typeof elevenlabs;
  google: typeof google;
  groq: typeof groq;
  hume: typeof hume;
  ollama: typeof ollama;
  openai: typeof openai;
  openaiCompatible: typeof openaiCompatible;
  mcp: typeof mcp;
};

export { ai, anthropic, deepseek, google, groq, hume, ollama, openai, openaiCompatible, mcp };
export { elevenlabs as elevenLabs };
