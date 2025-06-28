import { LLMCacheService } from './LLMCacheService';

type MockTable = {
  where: jest.Mock;
  equals: jest.Mock;
  and: jest.Mock;
  first: jest.Mock;
  toArray: jest.Mock;
  add: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

jest.mock('../../database/LLMCacheDatabase', () => {
  return {
    LLMCacheDatabase: jest.fn().mockImplementation(() => ({
      exactMatches: {
        where: jest.fn().mockReturnThis(),
        equals: jest.fn().mockReturnThis(),
        and: jest.fn().mockReturnThis(),
        first: jest.fn().mockResolvedValue(null),
        add: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        delete: jest.fn().mockResolvedValue(1),
        below: jest.fn().mockReturnThis(),
      } as unknown as MockTable,
      similarityMatches: {
        where: jest.fn().mockReturnThis(),
        equals: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        delete: jest.fn().mockResolvedValue(1),
        below: jest.fn().mockReturnThis(),
      } as unknown as MockTable,
    })),
  };
});

describe('LLMCacheService', () => {
  let cacheService: LLMCacheService;
  let mockDb: {
    exactMatches: MockTable;
    similarityMatches: MockTable;
  };

  beforeEach(() => {
    cacheService = new LLMCacheService();
    mockDb = (cacheService as any).db;
  });

  describe('getCachedResponse', () => {
    it('should return cached response for exact match', async () => {
      const mockResponse = {
        id: 1,
        query: 'test query',
        response:
          '{"commandType":"search","content":"test query","explanation":"test","confidence":0.9}',
        commandType: 'intent',
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        matchType: 'exact',
      };

      mockDb.exactMatches.first.mockResolvedValueOnce(mockResponse);

      const result = await cacheService.getCachedResponse('test query');
      expect(result).toBe(mockResponse.response);
      expect(mockDb.exactMatches.update).toHaveBeenCalled();
    });

    it('should return null when no match found', async () => {
      mockDb.exactMatches.first.mockResolvedValueOnce(null);
      mockDb.similarityMatches.toArray.mockResolvedValueOnce([]);

      const result = await cacheService.getCachedResponse('test query');
      expect(result).toBeNull();
    });
  });

  describe('cacheResponse', () => {
    it('should cache response for exact match type', async () => {
      const query = 'test query';
      const response = 'test response';
      const commandType = 'search';

      await cacheService.cacheResponse(query, response, commandType);
      expect(mockDb.exactMatches.add).toHaveBeenCalled();
    });

    it('should cache response for similarity match type', async () => {
      const query = 'test query';
      const response = 'test response';
      const commandType = 'close';

      await cacheService.cacheResponse(query, response, commandType);
      expect(mockDb.similarityMatches.add).toHaveBeenCalled();
    });
  });

  describe('determineMatchType', () => {
    it('should return exact for search, move, delete, calc', () => {
      const exactTypes = ['search', 'move', 'move_from_artifact', 'copy', 'delete', 'calc'];
      exactTypes.forEach(type => {
        expect((cacheService as any).determineMatchType(type)).toBe('exact');
      });
    });

    it('should return similarity for other types', () => {
      const similarityTypes = ['close', 'confirm', 'revert'];
      similarityTypes.forEach(type => {
        expect((cacheService as any).determineMatchType(type)).toBe('similarity');
      });
    });
  });
});
