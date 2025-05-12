import { App } from 'obsidian';
import { DocumentStore } from './documentStore';
import { Tokenizer } from './tokenizer';
import { Indexer } from './indexer';
import { Scoring } from './scoring';
import { SearchEngine } from './searchEngine';
import { EventRef } from 'obsidian';

export interface SearchServiceConfig {
	app: App;
	dbName: string;
	excludeFolders: string[];
}

/**
 * SearchService singleton that provides global access to search components
 */
export class SearchService {
	private static instance: SearchService | null = null;

	private app: App;
	private dbName: string;
	private excludeFolders: string[];

	public documentStore: DocumentStore;
	public tokenizer: Tokenizer;
	public indexer: Indexer;
	public scoring: Scoring;
	public searchEngine: SearchEngine;

	private eventRefs: EventRef[] = [];
	private isInitialized = false;

	private constructor(config: SearchServiceConfig) {
		this.app = config.app;
		this.dbName = config.dbName;
		this.excludeFolders = config.excludeFolders || [];

		// Initialize components
		this.tokenizer = new Tokenizer();
		this.documentStore = new DocumentStore({
			app: this.app,
			dbName: this.dbName,
			excludeFolders: this.excludeFolders,
		});
		this.indexer = new Indexer({
			app: this.app,
			documentStore: this.documentStore,
			tokenizer: this.tokenizer,
		});
		this.scoring = new Scoring(this.documentStore);
		this.searchEngine = new SearchEngine({
			app: this.app,
			documentStore: this.documentStore,
			tokenizer: this.tokenizer,
			scoring: this.scoring,
		});
	}

	/**
	 * Get the singleton instance of SearchService
	 */
	public static getInstance(config?: SearchServiceConfig): SearchService {
		if (!SearchService.instance) {
			if (!config) {
				throw new Error('SearchService must be initialized with app, dbName, and excludeFolders');
			}
			SearchService.instance = new SearchService(config);
		}
		return SearchService.instance;
	}

	/**
	 * Update exclude folders
	 */
	public updateExcludeFolders(excludeFolders: string[]): void {
		this.excludeFolders = excludeFolders;
		this.documentStore.updateExcludeFolders(excludeFolders);
	}

	/**
	 * Initialize the search service
	 */
	public async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		// Setup event listeners
		this.eventRefs = this.indexer.setupEventListeners();

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
		// Unregister event listeners
		this.eventRefs.forEach(ref => this.app.workspace.offref(ref));
		this.eventRefs = [];

		// Reset the singleton instance
		SearchService.instance = null;
		this.isInitialized = false;
	}
}
