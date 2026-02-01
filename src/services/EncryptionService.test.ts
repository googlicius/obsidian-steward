import { EncryptionService } from './EncryptionService';
import type StewardPlugin from 'src/main';

// Mock vault-specific localStorage
const vaultLocalStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    loadLocalStorage: (key: string): string | null => {
      return store[key];
    },
    saveLocalStorage: (key: string, value: string): void => {
      store[key] = value;
    },
    clear: (): void => {
      store = {};
    },
  };
})();

// Mock standard localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => {
      return store[key] || null;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    clear: (): void => {
      store = {};
    },
  };
})();

// Assign our mock to global localStorage
global.localStorage = localStorageMock as unknown as Storage;

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    app: {
      loadLocalStorage: jest.fn((key: string) => vaultLocalStorageMock.loadLocalStorage(key)),
      saveLocalStorage: jest.fn((key: string, value: string) =>
        vaultLocalStorageMock.saveLocalStorage(key, value)
      ),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('EncryptionService', () => {
  beforeEach(() => {
    vaultLocalStorageMock.clear();
    localStorageMock.clear();
  });

  describe('encrypt', () => {
    it('should create and store a new salt when none exists', () => {
      const mockPlugin = createMockPlugin();
      const encryptionService = EncryptionService.getInstance(mockPlugin);
      const saltKeyId = 'random-salt-key-id';

      // First access should create a new salt (via encryption)
      encryptionService.encrypt('test data', saltKeyId);

      // Salt should now exist in vault-specific localStorage
      expect(mockPlugin.app.saveLocalStorage).toHaveBeenCalledWith(saltKeyId, expect.any(String));
    });

    it('should load existing salt from storage when saltKeyId exists', () => {
      const mockPlugin = createMockPlugin();
      const encryptionService = EncryptionService.getInstance(mockPlugin);
      const saltKeyId = 'random-salt-key-id';

      // First encryption - creates the salt
      encryptionService.encrypt('test data', saltKeyId);

      // Second encryption - should load the existing salt
      encryptionService.encrypt('test data 2', saltKeyId);

      // Verify loadLocalStorage was called with the saltKeyId
      expect(mockPlugin.app.loadLocalStorage).toHaveBeenCalledWith(saltKeyId);
    });
  });

  describe('decrypt', () => {
    it('should encrypt and decrypt a string', () => {
      const mockPlugin = createMockPlugin();
      const encryptionService = EncryptionService.getInstance(mockPlugin);
      const saltKeyId = 'random-salt-key-id';

      // Test data
      const apiKey = 'sk-test12345abcdefg';

      // Encrypt the data
      const encryptedData = encryptionService.encrypt(apiKey, saltKeyId);

      // Encrypted data should be different from original
      expect(encryptedData).not.toBe(apiKey);

      // Decrypting should give us back the original
      const decryptedData = encryptionService.decrypt(encryptedData, saltKeyId);
      expect(decryptedData).toBe(apiKey);
    });
  });
});
