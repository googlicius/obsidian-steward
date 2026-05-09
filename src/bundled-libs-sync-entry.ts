/**
 * Small set of modules that must be available via a synchronous accessor.
 *
 * Bundled separately (and kept small) so sync usage doesn't have to decompress/eval the
 * larger `bundled-libs-entry` payload.
 *
 * Registry keys match npm package names.
 */
import * as chrono from 'chrono-node';
import * as CryptoJS from 'crypto-js';
import Dexie from 'dexie';

const syncLibs = {
  'chrono-node': chrono,
  'crypto-js': CryptoJS,
  dexie: Dexie,
};

export type BundledSyncLibs = typeof syncLibs;

export default syncLibs;
