import builtins from 'builtin-modules';

/** Shared between `esbuild.config.mjs` and `scripts/build-bundled-libs.mjs` (side-effect free). */
export const sharedExternal = [
  'obsidian',
  'electron',
  '@codemirror/autocomplete',
  '@codemirror/collab',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  ...builtins,
];
