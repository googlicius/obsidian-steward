/**
 * Map each loadable specifier to `typeof import('...')` or `typeof require('...')`.
 * Add an entry when you call {@link loadNodeModule} with a new built-in or package.
 */
export interface LoadableNodeModuleMap {
  child_process: typeof import('child_process');
}

export type LoadableNodeModuleSpecifier = keyof LoadableNodeModuleMap;

const nodeModuleLoadCache = new Map<string, Promise<unknown>>();

/**
 * Dynamically loads a Node built-in or package and caches the result.
 * For built-ins, uses `require()` so the CJS runtime can resolve them.
 * Prefer this over top-level imports for modules that are missing on some runtimes
 * (for example `child_process` on Obsidian Mobile).
 */
export function loadNodeModule<S extends LoadableNodeModuleSpecifier>(
  specifier: S
): Promise<LoadableNodeModuleMap[S]>;
export function loadNodeModule(specifier: string): Promise<unknown>;
export function loadNodeModule(specifier: string): Promise<unknown> {
  let pending = nodeModuleLoadCache.get(specifier);
  if (!pending) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pending = Promise.resolve(require(specifier));
    nodeModuleLoadCache.set(specifier, pending);
  }
  return pending;
}
