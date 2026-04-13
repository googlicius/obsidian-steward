import { UserMessageService } from './UserMessageService';
import type StewardPlugin from 'src/main';
import type { App } from 'obsidian';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(''),
    },
  } as unknown as App;

  const mockPlugin = {
    settings: {
      stewardFolder: 'Steward',
    },
    app: mockApp,
    registerEvent: jest.fn(),
  } as unknown as StewardPlugin;

  return mockPlugin as unknown as jest.Mocked<StewardPlugin>;
}

describe('UserMessageService', () => {
  let userMessageService: UserMessageService;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    userMessageService = UserMessageService.getInstance(mockPlugin);
  });

  describe('sanitizeQuery', () => {
    it('should handle query with slash "/ "', () => {
      const query = '/ test query';
      const result = userMessageService.sanitizeQuery(query);
      expect(result).toBe('/ test query');
    });

    it('should collapse multiple spaces on a single line', () => {
      expect(userMessageService.sanitizeQuery('hello    world')).toBe('hello world');
      expect(userMessageService.sanitizeQuery('a \t b')).toBe('a b');
    });

    it('should trim leading and trailing whitespace on the whole query', () => {
      expect(userMessageService.sanitizeQuery('  padded ')).toBe('padded');
    });

    it('should keep a multiline query with normalized lines', () => {
      const query = '  first line  \n second line  \nthird';
      const result = userMessageService.sanitizeQuery(query);
      expect(result).toBe('first line\nsecond line\nthird');
    });

    it('should preserve blank lines between paragraphs', () => {
      const query = 'paragraph one\n\nparagraph two';
      expect(userMessageService.sanitizeQuery(query)).toBe('paragraph one\n\nparagraph two');
    });

    it('should normalize CRLF to LF between lines', () => {
      const query = 'line one\r\nline two';
      expect(userMessageService.sanitizeQuery(query)).toBe('line one\nline two');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(userMessageService.sanitizeQuery('   \n\t  ')).toBe('');
    });
  });

  describe('hasReadableContent', () => {
    it('should return true if query contains readable content', () => {
      const query = 'test.md';
      const result = userMessageService.hasReadableContent(query);
      expect(result).toBe(true);
    });

    it('should return true if query contains readable content', () => {
      const query = 'Read My image.png and tell me what it is';
      const result = userMessageService.hasReadableContent(query);
      expect(result).toBe(true);
    });

    it('should return false if query does not contain readable content', () => {
      const query = 'Hello';
      const result = userMessageService.hasReadableContent(query);
      expect(result).toBe(false);
    });

    it('should return true if query contains readable files with mistakes', () => {
      const query = 'Read My image.pngand tell me what it is';
      const result = userMessageService.hasReadableContent(query);
      expect(result).toBe(true);
    });

    it('should return false if query contain file extensions only', () => {
      const query = 'Read my image .png and describe it';
      const result = userMessageService.hasReadableContent(query);
      expect(result).toBe(false);
    });
  });
});
