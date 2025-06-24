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
      userInput: '"project notes"',
    });

    expect(result1).toEqual({
      operations: [
        {
          keywords: ['"project notes"'],
          tags: [],
          filenames: [],
          folders: [],
        },
        {
          keywords: [],
          tags: [],
          filenames: ['project notes'],
          folders: [],
        },
      ],
      explanation: 'translated_search.searchingFor',
      lang: 'en',
      confidence: 1,
    });

    // Test with single quotes
    const result2 = await extractSearchQueryV2({
      userInput: "'meeting minutes'",
    });

    expect(result2).toEqual({
      operations: [
        {
          keywords: ['"meeting minutes"'],
          tags: [],
          filenames: [],
          folders: [],
        },
        {
          keywords: [],
          tags: [],
          filenames: ['meeting minutes'],
          folders: [],
        },
      ],
      explanation: 'translated_search.searchingFor',
      lang: 'en',
      confidence: 1,
    });
  });

  it('should handle tag-only input directly without LLM', async () => {
    // Test with multiple tags
    const result = await extractSearchQueryV2({
      userInput: '#project #work #important',
    });

    expect(result).toEqual({
      operations: [
        {
          keywords: [],
          tags: ['project', 'work', 'important'],
          filenames: [],
          folders: [],
        },
      ],
      explanation: 'translated_search.searchingForTags',
      lang: 'en',
      confidence: 1,
    });

    // Test with a single tag
    const singleTagResult = await extractSearchQueryV2({
      userInput: '#urgent',
    });

    expect(singleTagResult).toEqual({
      operations: [
        {
          keywords: [],
          tags: ['urgent'],
          filenames: [],
          folders: [],
        },
      ],
      explanation: 'translated_search.searchingForTags',
      lang: 'en',
      confidence: 1,
    });
  });
});
