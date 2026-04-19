/**
 * Desktop-only deps bundled separately so the main `bundled-libs-entry` chunk
 * does not eval `path` / other Node builtins (e.g. on Obsidian mobile).
 * Add more desktop-only packages here as needed.
 */
import * as nodePty from 'node-pty';
import * as socketIo from 'socket.io';

export type StewardBundledDesktopLibsRegistry = {
  nodePty: typeof nodePty;
  socketIo: typeof socketIo;
};

export { nodePty, socketIo };
