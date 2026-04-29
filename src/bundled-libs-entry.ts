/**
 * Bundled separately by scripts/build-bundled-libs.mjs, compressed, and loaded at runtime
 * so the main bundle does not parse/execute these dependencies at plugin startup.
 *
 * Registry keys match npm package names so `getBundledLib` keys align with `import('…')` specifiers.
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
import * as xterm from '@xterm/xterm';
import * as xtermAddonFit from '@xterm/addon-fit';
import * as xtermAddonSerialize from '@xterm/addon-serialize';
import * as socketIoClient from 'socket.io-client';
import stripAnsi from 'strip-ansi';
// Mustache is CJS (`module.exports = Mustache`); default import unwraps to the real module object.
import mustache from 'mustache';

const bundledLibs = {
  ai,
  '@ai-sdk/anthropic': anthropic,
  '@ai-sdk/elevenlabs': elevenlabs,
  '@ai-sdk/google': google,
  '@ai-sdk/hume': hume,
  'ollama-ai-provider-v2': ollama,
  '@ai-sdk/openai': openai,
  '@ai-sdk/openai-compatible': openaiCompatible,
  '@ai-sdk/mcp': mcp,
  '@xterm/xterm': xterm,
  '@xterm/addon-fit': xtermAddonFit,
  '@xterm/addon-serialize': xtermAddonSerialize,
  'socket.io-client': socketIoClient,
  'strip-ansi': stripAnsi,
  mustache,
};

export type BundledLibs = typeof bundledLibs;

export default bundledLibs;
