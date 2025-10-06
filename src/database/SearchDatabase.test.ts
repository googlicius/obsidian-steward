import { SearchDatabase } from './SearchDatabase';
import { logger } from '../utils/logger';

describe('SearchDatabase', () => {
  describe('cleanupOldDatabases', () => {
    let mockIndexedDB: {
      databases: jest.Mock;
      deleteDatabase: jest.Mock;
    };

    beforeEach(() => {
      // Reset all mocks
      jest.clearAllMocks();

      // Create mock IndexedDB
      mockIndexedDB = {
        databases: jest.fn(),
        deleteDatabase: jest.fn(),
      };

      // Replace global indexedDB with mock
      global.indexedDB = mockIndexedDB as unknown as IDBFactory;
    });

    afterEach(() => {
      // Clean up global indexedDB mock
      delete (global as { indexedDB?: IDBFactory }).indexedDB;
    });

    it('should return empty array if indexedDB.databases is not supported', async () => {
      // Setup: Remove databases method to simulate unsupported browser
      delete (mockIndexedDB as { databases?: jest.Mock }).databases;

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify
      expect(result).toEqual([]);
      expect(logger.log).toHaveBeenCalledWith(
        'indexedDB.databases() is not supported in this browser.'
      );
    });

    it('should delete old databases for the current vault', async () => {
      // Setup: Mock databases list
      const mockDatabases = [
        { name: 'steward_search_MyVault_abc123' }, // Current database
        { name: 'steward_search_MyVault_old123' }, // Old database to delete
        { name: 'steward_search_MyVault_old456' }, // Another old database to delete
        { name: 'steward_search_OtherVault_xyz789' }, // Different vault - should not delete
        { name: 'other_database' }, // Non-steward database - should not delete
      ];

      mockIndexedDB.databases.mockResolvedValue(mockDatabases);

      // Mock deleteDatabase to return success
      mockIndexedDB.deleteDatabase.mockImplementation((dbName: string) => {
        const mockRequest = {
          onsuccess: null as (() => void) | null,
          onerror: null as ((event: Event) => void) | null,
          onblocked: null as (() => void) | null,
        };

        // Simulate async success
        setTimeout(() => {
          if (mockRequest.onsuccess) {
            mockRequest.onsuccess();
          }
        }, 0);

        return mockRequest;
      });

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify
      expect(result).toEqual(['steward_search_MyVault_old123', 'steward_search_MyVault_old456']);
      expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledTimes(2);
      expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledWith('steward_search_MyVault_old123');
      expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledWith('steward_search_MyVault_old456');
      expect(logger.log).toHaveBeenCalledWith(
        'Found 2 old search database(s) to delete for vault "MyVault":',
        ['steward_search_MyVault_old123', 'steward_search_MyVault_old456']
      );
    });

    it('should return empty array if no old databases exist', async () => {
      // Setup: Mock databases list with only current database
      const mockDatabases = [
        { name: 'steward_search_MyVault_abc123' }, // Current database
        { name: 'other_database' }, // Non-steward database
      ];

      mockIndexedDB.databases.mockResolvedValue(mockDatabases);

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify
      expect(result).toEqual([]);
      expect(mockIndexedDB.deleteDatabase).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith(
        'No old search databases to clean up for vault:',
        'MyVault'
      );
    });

    it('should handle deletion errors gracefully', async () => {
      // Setup: Mock databases list
      const mockDatabases = [
        { name: 'steward_search_MyVault_abc123' }, // Current database
        { name: 'steward_search_MyVault_old123' }, // Old database - will fail to delete
      ];

      mockIndexedDB.databases.mockResolvedValue(mockDatabases);

      // Mock deleteDatabase to return error
      mockIndexedDB.deleteDatabase.mockImplementation((dbName: string) => {
        const mockRequest = {
          onsuccess: null as (() => void) | null,
          onerror: null as ((event: Event) => void) | null,
          onblocked: null as (() => void) | null,
        };

        // Simulate async error - use setImmediate to ensure callbacks are set first
        setImmediate(() => {
          if (mockRequest.onerror) {
            mockRequest.onerror(new Event('error'));
          }
        });

        return mockRequest;
      });

      // Execute - should return empty array and log error
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify - error is caught and empty array is returned
      expect(result).toEqual([]);
    });

    it('should handle blocked deletion gracefully', async () => {
      // Setup: Mock databases list
      const mockDatabases = [
        { name: 'steward_search_MyVault_abc123' }, // Current database
        { name: 'steward_search_MyVault_old123' }, // Old database - will be blocked
      ];

      mockIndexedDB.databases.mockResolvedValue(mockDatabases);

      // Mock deleteDatabase to return blocked status
      mockIndexedDB.deleteDatabase.mockImplementation((dbName: string) => {
        const mockRequest = {
          onsuccess: null as (() => void) | null,
          onerror: null as ((event: Event) => void) | null,
          onblocked: null as (() => void) | null,
        };

        // Simulate async blocked
        setTimeout(() => {
          if (mockRequest.onblocked) {
            mockRequest.onblocked();
          }
        }, 0);

        return mockRequest;
      });

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify - blocked databases are not added to deleted list but operation continues
      expect(result).toEqual([]);
      expect(logger.log).toHaveBeenCalledWith(
        'Deletion of database steward_search_MyVault_old123 is blocked'
      );
    });

    it('should handle databases with missing names', async () => {
      // Setup: Mock databases list with undefined/null names
      const mockDatabases = [
        { name: 'steward_search_MyVault_abc123' }, // Current database
        { name: undefined }, // Invalid database entry
        { name: null }, // Invalid database entry
        { name: 'steward_search_MyVault_old123' }, // Valid old database
      ];

      mockIndexedDB.databases.mockResolvedValue(mockDatabases);

      // Mock deleteDatabase to return success
      mockIndexedDB.deleteDatabase.mockImplementation((dbName: string) => {
        const mockRequest = {
          onsuccess: null as (() => void) | null,
          onerror: null as ((event: Event) => void) | null,
          onblocked: null as (() => void) | null,
        };

        setTimeout(() => {
          if (mockRequest.onsuccess) {
            mockRequest.onsuccess();
          }
        }, 0);

        return mockRequest;
      });

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify - only valid old database is deleted
      expect(result).toEqual(['steward_search_MyVault_old123']);
      expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledTimes(1);
    });

    it('should handle errors when retrieving database list', async () => {
      // Setup: Mock databases to throw error
      mockIndexedDB.databases.mockRejectedValue(new Error('Database list retrieval failed'));

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'Error retrieving or deleting databases:',
        expect.any(Error)
      );
    });

    it('should not delete databases from other vaults', async () => {
      // Setup: Mock databases from multiple vaults
      const mockDatabases = [
        { name: 'steward_search_MyVault_abc123' }, // Current database
        { name: 'steward_search_MyVault_old123' }, // Old database for MyVault
        { name: 'steward_search_OtherVault_xyz789' }, // OtherVault database
        { name: 'steward_search_OtherVault_old456' }, // OtherVault old database
      ];

      mockIndexedDB.databases.mockResolvedValue(mockDatabases);

      // Mock deleteDatabase to return success
      mockIndexedDB.deleteDatabase.mockImplementation((dbName: string) => {
        const mockRequest = {
          onsuccess: null as (() => void) | null,
          onerror: null as ((event: Event) => void) | null,
          onblocked: null as (() => void) | null,
        };

        setTimeout(() => {
          if (mockRequest.onsuccess) {
            mockRequest.onsuccess();
          }
        }, 0);

        return mockRequest;
      });

      // Execute
      const result = await SearchDatabase.cleanupOldDatabases(
        'steward_search_MyVault_abc123',
        'MyVault'
      );

      // Verify - only MyVault old database is deleted
      expect(result).toEqual(['steward_search_MyVault_old123']);
      expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledTimes(1);
      expect(mockIndexedDB.deleteDatabase).toHaveBeenCalledWith('steward_search_MyVault_old123');
      expect(mockIndexedDB.deleteDatabase).not.toHaveBeenCalledWith(
        'steward_search_OtherVault_xyz789'
      );
    });
  });
});
