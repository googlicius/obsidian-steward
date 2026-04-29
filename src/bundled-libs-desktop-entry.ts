/**
 * Desktop-only deps bundled separately so the main `bundled-libs-entry` chunk
 * does not eval `path` / other Node builtins (e.g. on Obsidian mobile).
 * Add more desktop-only packages here as needed.
 *
 * Registry keys match npm package names so `getBundledDesktopLib` keys align with `import('…')` specifiers.
 */
import * as nodePty from 'node-pty';
import * as socketIo from 'socket.io';

const libs = {
  'node-pty': nodePty,
  'socket.io': socketIo,
};

export type BundledDesktopLibs = typeof libs;

export default libs;
