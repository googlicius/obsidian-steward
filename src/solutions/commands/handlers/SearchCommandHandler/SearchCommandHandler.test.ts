import { SearchCommandHandler } from './SearchCommandHandler';
import type StewardPlugin from 'src/main';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { PaginatedSearchResult } from 'src/solutions/search/types';
import { MediaTools } from 'src/tools/mediaTools';
import { NoteContentService } from 'src/services/NoteContentService';
import { type App } from 'obsidian';
import { SearchService } from 'src/solutions/search';
import { CommandIntent } from 'src/types/types';
import { SearchQueryExtractionV2 } from './zSchemas';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(''),
    },
  } as unknown as App;

  const mockPlugin = {
    settings: {
      search: {
        resultsPerPage: 10,
        withoutLLM: 'relevant',
      },
      excludedFolders: [],
      stewardFolder: 'Steward',
      searchDbName: 'test-search',
    },
    app: mockApp,
    registerEvent: jest.fn(),
    llmService: {
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
      }),
    },
  } as unknown as StewardPlugin;

  return {
    ...mockPlugin,
    noteContentService: NoteContentService.getInstance(mockApp),
    searchService: SearchService.getInstance(mockPlugin),
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('SearchCommandHandler', () => {
  let searchCommandHandler: SearchCommandHandler;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    searchCommandHandler = new SearchCommandHandler(mockPlugin);
  });

  describe('extractSearchQueryV2', () => {
    // We need to access the private method for testing
    let extractSearchQueryV2: (params: {
      command: CommandIntent;
      searchSettings?: StewardPlugin['settings']['search'];
      lang?: string | null;
    }) => Promise<SearchQueryExtractionV2>;

    beforeEach(() => {
      // Access the private method using type assertion
      extractSearchQueryV2 =
        searchCommandHandler['extractSearchQueryV2'].bind(searchCommandHandler);
    });

    it('should handle quoted keyword input directly without LLM', async () => {
      // Test with double quotes
      const result1 = await extractSearchQueryV2({
        command: {
          commandType: 'search',
          query: '"project notes"',
        },
        searchSettings: {
          withoutLLM: 'relevant',
          resultsPerPage: 10,
        },
      });

      expect(result1).toEqual({
        operations: [
          {
            keywords: [],
            filenames: ['project notes'],
            folders: [],
            properties: [],
          },
          {
            keywords: ['project notes'],
            filenames: [],
            folders: [],
            properties: [],
          },
        ],
        explanation: 'translated_search.searchingFor',
        lang: 'en',
        confidence: 1,
        needsLLM: false,
      });

      // Test with single quotes
      const result2 = await extractSearchQueryV2({
        command: {
          commandType: 'search',
          query: "'meeting minutes'",
        },
        searchSettings: {
          withoutLLM: 'exact',
          resultsPerPage: 10,
        },
      });

      expect(result2).toEqual({
        operations: [
          {
            keywords: [],
            filenames: ['meeting minutes'],
            folders: [],
            properties: [],
          },
          {
            keywords: ['"meeting minutes"'],
            filenames: [],
            folders: [],
            properties: [],
          },
        ],
        explanation: 'translated_search.searchingFor',
        lang: 'en',
        confidence: 1,
        needsLLM: false,
      });
    });

    it('should handle tag-only input directly without LLM', async () => {
      // Test with multiple tags
      const result = await extractSearchQueryV2({
        command: {
          commandType: 'search',
          query: '#project, #work #important',
        },
      });

      expect(result).toEqual({
        operations: [
          {
            keywords: [],
            filenames: [],
            folders: [],
            properties: [
              { name: 'tag', value: 'project' },
              { name: 'tag', value: 'work' },
              { name: 'tag', value: 'important' },
            ],
          },
        ],
        explanation: 'translated_search.searchingForTags',
        lang: 'en',
        confidence: 1,
        needsLLM: false,
      });

      // Test with a single tag
      const singleTagResult = await extractSearchQueryV2({
        command: {
          commandType: 'search',
          query: '#urgent',
        },
      });

      expect(singleTagResult).toEqual({
        operations: [
          {
            keywords: [],
            filenames: [],
            folders: [],
            properties: [{ name: 'tag', value: 'urgent' }],
          },
        ],
        explanation: 'translated_search.searchingForTags',
        lang: 'en',
        confidence: 1,
        needsLLM: false,
      });
    });
  });

  describe('formatSearchResults', () => {
    let mockMediaTools: jest.Mocked<MediaTools>;
    let vaultCachedReadSpy: jest.SpyInstance;

    let paginatedSearchResult: PaginatedSearchResult<IndexedDocument>;

    beforeEach(() => {
      const mockFile = { path: 'Test Note.md' };
      mockMediaTools = {
        findFileByNameOrPath: jest.fn().mockResolvedValue(mockFile),
      } as unknown as jest.Mocked<MediaTools>;

      // Mock the static getInstance method
      jest.spyOn(MediaTools, 'getInstance').mockReturnValue(mockMediaTools);

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
      await searchCommandHandler.formatSearchResults({
        paginatedSearchResult,
      });

      // Assert
      expect(MediaTools.getInstance).toHaveBeenCalled();
      expect(mockMediaTools.findFileByNameOrPath).toHaveBeenCalledWith('Test Note.md');
      expect(vaultCachedReadSpy).toHaveBeenCalled();
    });

    it('should format search results with one item', async () => {
      // Act
      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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

      const result = await searchCommandHandler.formatSearchResults({
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
