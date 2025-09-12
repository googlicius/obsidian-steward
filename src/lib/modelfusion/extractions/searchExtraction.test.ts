import { extractSearchQueryV2 } from './searchExtraction';

// Mock the language utility
jest.mock('src/utils/getObsidianLanguage', () => ({
  getObsidianLanguage: () => 'en',
}));

// Mock the AI SDK
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

// Mock the LLMService
jest.mock('src/services/LLMService', () => ({
  LLMService: {
    getInstance: jest.fn().mockReturnValue({
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
      }),
    }),
  },
}));

describe('extractSearchQueryV2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
