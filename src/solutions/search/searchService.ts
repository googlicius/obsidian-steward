import { DocumentStore } from './documentStore';
import { Tokenizer } from './tokenizer';
import { Indexer } from './indexer';
import { Scoring } from './scoring';
import { SearchEngine } from './searchEngine';
import type StewardPlugin from '../../main';

/**
 * SearchService singleton that provides global access to search components
 */
export class SearchService {
  private static instance: SearchService | null = null;

  private plugin: StewardPlugin;
  private excludeFolders: string[];

  public documentStore: DocumentStore;
  public tokenizer: Tokenizer;
  public indexer: Indexer;
  public scoring: Scoring;
  public searchEngine: SearchEngine;

  private isInitialized = false;

  private constructor(plugin: StewardPlugin) {
    this.plugin = plugin;
    this.excludeFolders = [
      ...this.plugin.settings.excludedFolders,
      `${this.plugin.settings.stewardFolder}/Conversations`,
    ];

    // Initialize components
    this.tokenizer = new Tokenizer();
    this.documentStore = new DocumentStore({
      app: this.plugin.app,
      dbName: this.plugin.settings.searchDbPrefix,
      excludeFolders: this.excludeFolders,
    });
    this.indexer = new Indexer({
      app: this.plugin.app,
      documentStore: this.documentStore,
      tokenizer: this.tokenizer,
    });
    this.scoring = new Scoring(this.documentStore);
    this.searchEngine = new SearchEngine({
      documentStore: this.documentStore,
      tokenizer: this.tokenizer,
      scoring: this.scoring,
    });
  }

  /**
   * Get the singleton instance of SearchService
   */
  public static getInstance(plugin?: StewardPlugin): SearchService {
    if (plugin) {
      SearchService.instance = new SearchService(plugin);
      return SearchService.instance;
    }
    if (!SearchService.instance) {
      throw new Error('SearchService must be initialized with a plugin instance');
    }
    return SearchService.instance;
  }

  /**
   * Update exclude folders
   */
  public updateExcludeFolders(excludeFolders: string[]): void {
    this.excludeFolders = [
      ...excludeFolders,
      `${this.plugin.settings.stewardFolder}/Conversations`,
    ];
    this.documentStore.updateExcludeFolders(this.excludeFolders);
  }

  /**
   * Initialize the search service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Setup event listeners
    const eventRefs = this.indexer.setupEventListeners();

    for (let index = 0; index < eventRefs.length; index++) {
      const eventRef = eventRefs[index];
      this.plugin.registerEvent(eventRef);
    }

    // Check if index is built
    const indexBuilt = await this.documentStore.isIndexBuilt();
    if (!indexBuilt) {
      // Build index if not already built
      await this.indexer.indexAllFiles();
    }

    this.isInitialized = true;
  }

  /**
   * Unload the search service
   */
  public unload(): void {
    // Reset the singleton instance
    SearchService.instance = null;
    this.isInitialized = false;
  }
}
