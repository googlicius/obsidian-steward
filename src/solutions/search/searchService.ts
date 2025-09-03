import { DocumentStore } from './documentStore';
import { Tokenizer } from './tokenizer';
import { Indexer } from './indexer';
import { Scoring } from './scoring';
import type StewardPlugin from '../../main';
import {
  AndCondition,
  Condition,
  ConditionResult,
  FilenameCondition,
  FolderCondition,
  KeywordCondition,
  PropertyCondition,
  QueryBuilder,
  QueryExecutor,
  QueryResult,
  SearchContext,
} from './searchEngineV3';
import { SearchOperationV2 } from 'src/lib/modelfusion';
import { PaginatedSearchResult } from './types';

/**
 * SearchService singleton that provides global access to search components
 */
export class SearchService {
  private static instance: SearchService | null = null;
  private excludeFolders: string[];

  public documentStore: DocumentStore;
  /**
   * Note content tokenizer is used to tokenize the content of the note
   */
  public contentTokenizer: Tokenizer;
  /**
   * Note name tokenizer is used to tokenize the note name or folder name
   */
  public nameTokenizer: Tokenizer;
  public indexer: Indexer;
  public scoring: Scoring;

  private isInitialized = false;

  private constructor(private plugin: StewardPlugin) {
    this.excludeFolders = [
      ...plugin.settings.excludedFolders,
      `${plugin.settings.stewardFolder}/Conversations`,
    ];

    // Initialize components
    this.contentTokenizer = new Tokenizer({
      normalizers: [
        'removeHtmlComments',
        'lowercase',
        'removeSpecialChars',
        'removeVietnameseDiacritics',
        'removeStwSelectedPatterns',
        'removeStwSqueezedPatterns',
      ],
    });

    this.nameTokenizer = new Tokenizer({
      normalizers: ['lowercase', 'removeSpecialChars', 'removeVietnameseDiacritics'],
      analyzers: ['wordDelimiter'],
    });

    this.documentStore = new DocumentStore({
      app: plugin.app,
      dbName: plugin.settings.searchDbPrefix,
      excludeFolders: this.excludeFolders,
    });
    this.indexer = new Indexer({
      app: this.plugin.app,
      documentStore: this.documentStore,
      contentTokenizer: this.contentTokenizer,
      nameTokenizer: this.nameTokenizer,
    });
    this.scoring = new Scoring(this.documentStore);
  }

  get searchContext(): SearchContext {
    return {
      documentStore: this.documentStore,
      nameTokenizer: this.nameTokenizer,
      contentTokenizer: this.contentTokenizer,
      scoring: this.scoring,
    };
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
    this.excludeFolders = [...excludeFolders, this.plugin.settings.stewardFolder];
    this.documentStore.updateExcludeFolders(this.excludeFolders);
  }

  /**
   * Initialize the search service
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Check if index is built and set the flag accordingly
    const isIndexBuilt = await this.documentStore.isIndexBuilt();
    this.indexer.setIndexBuilt(isIndexBuilt);

    // Setup event listeners
    this.plugin.app.workspace.onLayoutReady(() => {
      const eventRefs = this.indexer.setupEventListeners();

      for (let index = 0; index < eventRefs.length; index++) {
        const eventRef = eventRefs[index];
        this.plugin.registerEvent(eventRef);
      }
    });

    this.isInitialized = true;
  }

  /**
   * Search for documents using the v3 search engine
   */
  public searchV3(operations: SearchOperationV2[]): Promise<QueryResult> {
    const queryExecutor = new QueryExecutor(this.searchContext);

    const queryBuilder = new QueryBuilder();

    for (const operation of operations) {
      const { filenames = [], folders = [], keywords = [], properties = [] } = operation;
      const andConditions: Condition[] = [];

      // Add conditions using the generic approach
      if (filenames.length > 0) {
        andConditions.push(new FilenameCondition(filenames));
      }
      if (folders.length > 0) {
        andConditions.push(new FolderCondition(folders));
      }
      if (keywords.length > 0) {
        andConditions.push(new KeywordCondition(keywords));
      }
      if (properties.length > 0) {
        andConditions.push(new PropertyCondition(properties));
      }

      queryBuilder.or(new AndCondition(...andConditions));
    }

    const condition = queryBuilder.build();

    return queryExecutor.execute(condition);
  }

  /**
   * Paginate search results
   */
  public paginateResults(results: ConditionResult[], page = 1, limit = 20): PaginatedSearchResult {
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    return {
      conditionResults: results.slice(startIndex, endIndex),
      totalCount: results.length,
      page,
      limit,
      totalPages: Math.ceil(results.length / limit),
    };
  }

  /**
   * Get a single document by name using similarity matching
   * @param name The name of the document to find
   * @returns The found document or null if not found
   */
  public async getDocumentByName(name: string): Promise<ConditionResult | null> {
    const queryExecutor = new QueryExecutor(this.searchContext);

    const queryBuilder = new QueryBuilder();
    queryBuilder.and(new FilenameCondition([name]));

    const condition = queryBuilder.build();
    const result = await queryExecutor.execute(condition);
    const results = result.conditionResults;

    return results.length > 0 ? results[0] : null;
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
