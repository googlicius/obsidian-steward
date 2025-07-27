import { FileCache } from 'modelfusion/node';
import { FileSystemAdapter, normalizePath } from 'obsidian';
import type StewardPlugin from '../../main';

// Singleton instance of the cache
let fileCache: FileCache | null = null;

/**
 * Service to manage file caches for ModelFusion
 */
export class FileCacheService {
  /**
   * Initialize the file cache with the plugin instance
   * @param plugin - The StewardPlugin instance
   */
  static initialize(plugin: StewardPlugin): void {
    if (fileCache) return;

    try {
      const adapter = plugin.app.vault.adapter as FileSystemAdapter;
      const basePath = normalizePath(adapter.getBasePath());

      fileCache = new FileCache({
        cacheDir: `${basePath}/.obsidian/steward-cache/embeddings`,
      });
    } catch (error) {
      console.error('Failed to initialize embedding cache:', error);
      // Create a fallback in-memory cache
      fileCache = new FileCache({
        cacheDir: '.cache/embeddings-temp',
      });
    }
  }

  /**
   * Get the embedding cache instance
   * @returns The FileCache instance or null if not initialized
   */
  static getCache(): FileCache | null {
    return fileCache;
  }
}
