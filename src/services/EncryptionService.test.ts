import { EncryptionService } from './EncryptionService';
import type StewardPlugin from 'src/main';
import { generateId } from 'ai';

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
  });

  describe('encrypt', () => {
    it('should create and store a new salt when none exists', () => {
      const mockPlugin = createMockPlugin();
      const encryptionService = EncryptionService.getInstance(mockPlugin);
      const saltKeyId = generateId();

      // First access should create a new salt (via encryption)
      encryptionService.encrypt('test data', saltKeyId);

      // Salt should now exist in vault-specific localStorage
      expect(mockPlugin.app.saveLocalStorage).toHaveBeenCalledWith(saltKeyId, expect.any(String));
    });

    it('should load existing salt from storage when saltKeyId exists', () => {
      const mockPlugin = createMockPlugin();
      const encryptionService = EncryptionService.getInstance(mockPlugin);
      const saltKeyId = generateId();

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
      const saltKeyId = generateId();

      // Test data
      const apiKey = 'sk-test12345abcdefg';

      // Encrypt the data
      const encryptedData = encryptionService.encrypt(apiKey, saltKeyId);

      expect(encryptedData.length).toBeGreaterThan(0);
      expect(encryptedData).not.toBe(apiKey);

      // Decrypting should give us back the original
      const decryptedData = encryptionService.decrypt(encryptedData, saltKeyId);
      expect(decryptedData).toBe(apiKey);
    });
  });
});
