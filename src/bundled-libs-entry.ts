/**
 * Bundled separately by scripts/build-bundled-libs.mjs, compressed, and loaded at runtime
 * so the main bundle does not parse/execute these dependencies at plugin startup.
 */
import * as ai from 'ai';
import * as anthropic from '@ai-sdk/anthropic';
import * as elevenlabs from '@ai-sdk/elevenlabs';
import * as google from '@ai-sdk/google';
import * as hume from '@ai-sdk/hume';
import * as ollama from 'ollama-ai-provider-v2';
import * as openai from '@ai-sdk/openai';
import * as mcp from '@ai-sdk/mcp';
import * as openaiCompatible from '@ai-sdk/openai-compatible';
import * as nodePty from 'node-pty';
import * as xterm from '@xterm/xterm';
import * as xtermAddonFit from '@xterm/addon-fit';

export type StewardBundledLibsRegistry = {
  ai: typeof ai;
  anthropic: typeof anthropic;
  elevenLabs: typeof elevenlabs;
  google: typeof google;
  hume: typeof hume;
  ollama: typeof ollama;
  openai: typeof openai;
  openaiCompatible: typeof openaiCompatible;
  mcp: typeof mcp;
  nodePty: typeof nodePty;
  xterm: typeof xterm;
  xtermAddonFit: typeof xtermAddonFit;
};

export {
  ai,
  anthropic,
  google,
  hume,
  ollama,
  openai,
  openaiCompatible,
  mcp,
  nodePty,
  xterm,
  xtermAddonFit,
};
export { elevenlabs as elevenLabs };
