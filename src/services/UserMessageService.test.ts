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
    it('should remove selected model pattern with "model:" prefix from query', () => {
      const query = '/ model:openai:gpt-4   test query';
      const result = userMessageService.sanitizeQuery(query);
      expect(result).toBe('/ test query');
    });

    it('should handle query with slash "/ "', () => {
      const query = '/ test query';
      const result = userMessageService.sanitizeQuery(query);
      expect(result).toBe('/ test query');
    });

    it('should handle query with slash "/ " and selected model pattern', () => {
      const query = '/ m:openai:gpt-4-turbo-preview test query';
      const result = userMessageService.sanitizeQuery(query);
      expect(result).toBe('/ test query');
    });

    it('should handle query with slash "/ " and only model pattern', () => {
      const query = '/ m:openai:gpt-4-turbo-preview';
      const result = userMessageService.sanitizeQuery(query);
      expect(result).toBe('/');
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
