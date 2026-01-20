import { Search, searchQueryExtractionSchema } from './Search';
import { type SuperAgent } from '../SuperAgent';
import type StewardPlugin from 'src/main';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { PaginatedSearchResult } from 'src/solutions/search/types';
import { MediaTools } from 'src/tools/mediaTools';
import { NoteContentService } from 'src/services/NoteContentService';
import { TFile, type App } from 'obsidian';
import { SearchService } from 'src/solutions/search';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(''),
      getFileByPath: jest.fn().mockReturnValue(null),
      config: {
        attachmentFolderPath: 'attachments',
      },
    },
    metadataCache: {
      getFirstLinkpathDest: jest.fn(),
    },
  } as unknown as App;

  const mockRenderer = {
    updateConversationNote: jest.fn().mockResolvedValue('message-id-123'),
    serializeToolInvocation: jest.fn(),
    extractConversationHistory: jest.fn().mockResolvedValue([]),
  };

  const mockArtifactManager = {
    withTitle: jest.fn().mockReturnValue({
      storeArtifact: jest.fn().mockResolvedValue('artifact-id-123'),
      getMostRecentArtifactOfTypes: jest.fn(),
      getArtifactById: jest.fn(),
    }),
  };

  const mockPlugin = {
    settings: {
      search: {
        resultsPerPage: 10,
        searchDbName: 'test-search',
      },
      excludedFolders: [],
      stewardFolder: 'Steward',
    },
    app: mockApp,
    registerEvent: jest.fn(),
    conversationRenderer: mockRenderer,
    artifactManagerV2: mockArtifactManager,
    get mediaTools() {
      return mockPlugin._mediaTools;
    },
    get noteContentService() {
      return mockPlugin._noteContentService;
    },
    get searchService() {
      return mockPlugin._searchService;
    },
  } as unknown as StewardPlugin;

  // Initialize services with the mock plugin
  mockPlugin._mediaTools = MediaTools.getInstance(mockPlugin.app);
  mockPlugin._noteContentService = NoteContentService.getInstance(mockPlugin);
  mockPlugin._searchService = SearchService.getInstance(mockPlugin);

  // Mock the documentStore.isIndexBuilt method
  jest.spyOn(mockPlugin._searchService.documentStore, 'isIndexBuilt').mockResolvedValue(true);

  return mockPlugin as unknown as jest.Mocked<StewardPlugin>;
}

describe('Search', () => {
  let search: Search;
  let mockAgent: jest.Mocked<SuperAgent>;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    mockAgent = {
      plugin: mockPlugin,
      renderer: mockPlugin.conversationRenderer,
    } as unknown as jest.Mocked<SuperAgent>;
    search = new Search(mockAgent);
  });

  describe('searchQueryExtractionSchema', () => {
    it('should split operation with both keywords and tags into two operations', () => {
      const input = {
        operations: [
          {
            keywords: ['test', 'example'],
            filenames: ['note'],
            folders: ['/folder'],
            properties: [
              { name: 'tag', value: 'important' },
              { name: 'status', value: 'completed' },
            ],
          },
        ],
        confidence: 0.9,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0]).toEqual({
        keywords: ['test', 'example'],
        filenames: ['note'],
        folders: ['/folder'],
        properties: [{ name: 'status', value: 'completed' }],
      });
      expect(result.operations[1]).toEqual({
        keywords: [],
        filenames: ['note'],
        folders: ['/folder'],
        properties: [{ name: 'tag', value: 'important' }],
      });
      expect(result.confidence).toBe(0.9);
    });

    it('should keep operation with only keywords unchanged', () => {
      const input = {
        operations: [
          {
            keywords: ['test', 'example'],
            filenames: [],
            folders: [],
            properties: [],
          },
        ],
        confidence: 0.8,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toEqual(input.operations[0]);
    });

    it('should keep operation with only tags unchanged', () => {
      const input = {
        operations: [
          {
            keywords: [],
            filenames: [],
            folders: [],
            properties: [
              { name: 'tag', value: 'important' },
              { name: 'tag', value: 'urgent' },
            ],
          },
        ],
        confidence: 0.7,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toEqual(input.operations[0]);
    });

    it('should keep operation with keywords and non-tag properties unchanged', () => {
      const input = {
        operations: [
          {
            keywords: ['test'],
            filenames: [],
            folders: [],
            properties: [
              { name: 'status', value: 'completed' },
              { name: 'file_type', value: 'md' },
            ],
          },
        ],
        confidence: 0.85,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toEqual(input.operations[0]);
    });

    it('should handle multiple operations, splitting only those with keywords and tags', () => {
      const input = {
        operations: [
          {
            keywords: ['test'],
            filenames: [],
            folders: [],
            properties: [{ name: 'tag', value: 'important' }],
          },
          {
            keywords: ['example'],
            filenames: [],
            folders: [],
            properties: [],
          },
          {
            keywords: [],
            filenames: [],
            folders: [],
            properties: [{ name: 'tag', value: 'urgent' }],
          },
        ],
        confidence: 0.9,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(4);
      // First operation split into two
      expect(result.operations[0]).toEqual({
        keywords: ['test'],
        filenames: [],
        folders: [],
        properties: [],
      });
      expect(result.operations[1]).toEqual({
        keywords: [],
        filenames: [],
        folders: [],
        properties: [{ name: 'tag', value: 'important' }],
      });
      // Second operation unchanged
      expect(result.operations[2]).toEqual(input.operations[1]);
      // Third operation unchanged
      expect(result.operations[3]).toEqual(input.operations[2]);
    });

    it('should preserve filenames and folders when splitting operations', () => {
      const input = {
        operations: [
          {
            keywords: ['test'],
            filenames: ['note1', 'note2'],
            folders: ['/folder1', '/folder2'],
            properties: [
              { name: 'tag', value: 'important' },
              { name: 'status', value: 'active' },
            ],
          },
        ],
        confidence: 0.95,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].filenames).toEqual(['note1', 'note2']);
      expect(result.operations[0].folders).toEqual(['/folder1', '/folder2']);
      expect(result.operations[1].filenames).toEqual(['note1', 'note2']);
      expect(result.operations[1].folders).toEqual(['/folder1', '/folder2']);
    });

    it('should handle operation with multiple tags correctly', () => {
      const input = {
        operations: [
          {
            keywords: ['test', 'example'],
            filenames: [],
            folders: [],
            properties: [
              { name: 'tag', value: 'important' },
              { name: 'tag', value: 'urgent' },
              { name: 'status', value: 'completed' },
            ],
          },
        ],
        confidence: 0.9,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(2);
      expect(result.operations[0].keywords).toEqual(['test', 'example']);
      expect(result.operations[0].properties).toEqual([{ name: 'status', value: 'completed' }]);
      expect(result.operations[1].keywords).toEqual([]);
      expect(result.operations[1].properties).toEqual([
        { name: 'tag', value: 'important' },
        { name: 'tag', value: 'urgent' },
      ]);
    });

    it('should handle empty operations array', () => {
      const input = {
        operations: [],
        confidence: 0.5,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.operations).toHaveLength(0);
      expect(result.confidence).toBe(0.5);
    });

    it('should preserve lang field when provided', () => {
      const input = {
        operations: [
          {
            keywords: ['test'],
            filenames: [],
            folders: [],
            properties: [{ name: 'tag', value: 'important' }],
          },
        ],
        lang: 'en',
        confidence: 0.9,
      };

      const result = searchQueryExtractionSchema.parse(input);

      expect(result.lang).toBe('en');
      expect(result.operations).toHaveLength(2);
    });
  });

  describe('formatSearchResults', () => {
    let findFileByNameOrPathSpy: jest.SpyInstance;
    let vaultCachedReadSpy: jest.SpyInstance;

    let paginatedSearchResult: PaginatedSearchResult<IndexedDocument>;
    let formatSearchResults: (typeof search)['formatSearchResults'];

    beforeEach(() => {
      // Access the private method using type assertion
      formatSearchResults = search['formatSearchResults'].bind(search);

      const mockFile = new TFile();
      mockFile.path = 'Test Note.md';

      // Spy on the mediaTools.findFileByNameOrPath method
      findFileByNameOrPathSpy = jest
        .spyOn(mockPlugin.mediaTools, 'findFileByNameOrPath')
        .mockResolvedValue(mockFile);

      // Mock vault.cachedRead to return file content
      vaultCachedReadSpy = jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue('This is a test note with example content.');

      // Create reusable mock data
      const mockDocument = {
        id: 1,
        path: 'Test Note.md',
        fileName: 'test note',
        lastModified: Date.now(),
        tags: ['test'],
        tokenCount: 100,
      };

      const mockConditionResult = {
        document: mockDocument,
        score: 0.95,
        keywordsMatched: ['test example'],
      };

      paginatedSearchResult = {
        conditionResults: [mockConditionResult],
        totalCount: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
    });

    it('should call mocked methods when formatting search results', async () => {
      // Act
      await formatSearchResults({
        paginatedSearchResult,
      });

      // Assert
      expect(findFileByNameOrPathSpy).toHaveBeenCalledWith('Test Note.md');
      expect(vaultCachedReadSpy).toHaveBeenCalled();
    });

    it('should format search results with one item', async () => {
      // Act
      const result = await formatSearchResults({
        paginatedSearchResult,
        headerText: 'Search results for "test"',
      });

      // Assert
      expect(result).toEqual(`Search results for "test"

translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:10,end:32,path:Test Note.md
>This is a ==test== note with ==example== content.
`);
    });

    it('should sorted by most match number', async () => {
      jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue(
          'This is a test note with example content.\nShe took the test yesterday.'
        );

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['Took test yesterday'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:2,start:4,end:27,path:Test Note.md
>She ==took== the ==test yesterday==.

>[!stw-search-result] line:1,start:10,end:14,path:Test Note.md
>This is a ==test== note with example content.
`);
    });

    it('should highlight words with a comma', async () => {
      jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue('I have a black cat, white dog, and a goose.');

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['black cat, white dog'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:9,end:29,path:Test Note.md
>I have a ==black cat==, ==white dog==, and a goose.
`);
    });

    it('should highlight tags', async () => {
      jest.spyOn(mockPlugin.app.vault, 'cachedRead').mockResolvedValue('My tag: #black_cat.');

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['#black_cat'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:8,end:18,path:Test Note.md
>My tag: ==#black_cat==.
`);
    });

    it('should highlight 2 adjacent words as one', async () => {
      jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue('I have a black cat and a white dog.');

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['black cat white dog'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:9,end:34,path:Test Note.md
>I have a ==black cat== and a ==white dog==.
`);
    });

    it('should remove lines only contain highlighted stopwords', async () => {
      jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue('I have a black cat and a white dog.\nA cow and a chicken.');

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['black cat and white dog'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:9,end:34,path:Test Note.md
>I have a ==black cat and== a ==white dog==.
`);
    });

    it('should highlight whole words and links correctly', async () => {
      jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue(
          'Totto-chan walked [sedately](sedately). Rocky walked sedately too, looking up at Totto-chan [from time to time](from%20time%20to%20time)'
        );

      paginatedSearchResult.conditionResults[0].keywordsMatched = [
        'Rocky walks sedately and looking up to Totto-chan',
      ];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:0,end:105,path:Test Note.md
>==Totto-chan walked== [==sedately==](sedately). ==Rocky walked sedately== too, ==looking up== at ==Totto-chan== [from time ==to== time](from%20time%20to%20time)
`);
    });

    it('should highlight tag with slash', async () => {
      jest.spyOn(mockPlugin.app.vault, 'cachedRead').mockResolvedValue('#tag/subtag This is test');

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['#tag/subtag'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:0,end:11,path:Test Note.md
>==#tag/subtag== This is test
`);
    });

    it('should highlight words stem to the same root', async () => {
      jest
        .spyOn(mockPlugin.app.vault, 'cachedRead')
        .mockResolvedValue('I walked in the park yesterday.');

      paginatedSearchResult.conditionResults[0].keywordsMatched = ['He is walking in the park'];

      const result = await formatSearchResults({
        paginatedSearchResult,
      });

      expect(result).toEqual(`translated_search.found

**1.** [[Test Note.md]]

>[!stw-search-result] line:1,start:2,end:20,path:Test Note.md
>I ==walked in the park== yesterday.
`);
    });
  });
});
