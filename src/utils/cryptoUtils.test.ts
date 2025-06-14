import { encrypt, decrypt, generateSaltKeyId } from './cryptoUtils';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => {
      return store[key] || null;
    },
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    clear: (): void => {
      store = {};
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    getAll: (): Record<string, string> => {
      return store;
    },
  };
})();

// Assign our mock to global localStorage
global.localStorage = localStorageMock as any;

// Mock the console.log and console.error to avoid cluttering test output
global.console.log = jest.fn();
global.console.error = jest.fn();

describe('Crypto Utilities', () => {
  // Clear localStorage before each test
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  test('should generate a unique salt key ID', () => {
    const keyId1 = generateSaltKeyId();
    const keyId2 = generateSaltKeyId();

    // ID should be a random string
    expect(typeof keyId1).toBe('string');
    expect(keyId1.length).toBeGreaterThan(5);
    expect(keyId1).not.toBe(keyId2);
  });

  test('should create and store a new salt when none exists', () => {
    const saltKeyId = generateSaltKeyId();

    // First access should create a new salt
    expect(localStorageMock.getItem(saltKeyId)).toBeNull();

    // Encrypt something to trigger salt creation
    encrypt('test data', saltKeyId);

    // Salt should now exist in localStorage
    expect(localStorageMock.getItem(saltKeyId)).not.toBeNull();
  });

  test('should encrypt and decrypt a string', () => {
    // Generate a salt key ID
    const saltKeyId = generateSaltKeyId();

    // Test data
    const apiKey = 'sk-test12345abcdefg';

    // Encrypt the data
    const encryptedData = encrypt(apiKey, saltKeyId);

    // Encrypted data should be different from original
    expect(encryptedData).not.toBe(apiKey);

    // Decrypting should give us back the original
    const decryptedData = decrypt(encryptedData, saltKeyId);
    expect(decryptedData).toBe(apiKey);
  });

  test('should handle empty input gracefully', () => {
    const saltKeyId = generateSaltKeyId();
    expect(encrypt('', saltKeyId)).toBe('');
    expect(decrypt('', saltKeyId)).toBe('');
  });

  test('encrypts same input differently with different salt key IDs', () => {
    const apiKey = 'sk-test12345abcdefg';

    const saltKeyId1 = generateSaltKeyId();
    const saltKeyId2 = generateSaltKeyId();

    const encryptedWithSalt1 = encrypt(apiKey, saltKeyId1);
    const encryptedWithSalt2 = encrypt(apiKey, saltKeyId2);

    // Different salts should produce different encrypted outputs
    expect(encryptedWithSalt1).not.toBe(encryptedWithSalt2);

    // But decrypting with the right salt should work
    expect(decrypt(encryptedWithSalt1, saltKeyId1)).toBe(apiKey);
    expect(decrypt(encryptedWithSalt2, saltKeyId2)).toBe(apiKey);
  });

  test('should use the same salt for repeated operations with the same key ID', () => {
    const saltKeyId = generateSaltKeyId();
    const testData = 'test-data-123';

    // First encryption
    const encrypted1 = encrypt(testData, saltKeyId);

    // Second encryption should use the same salt
    const encrypted2 = encrypt(testData, saltKeyId);

    // The results should be different due to the encryption process itself
    // but both should decrypt to the same value
    expect(decrypt(encrypted1, saltKeyId)).toBe(testData);
    expect(decrypt(encrypted2, saltKeyId)).toBe(testData);
  });

  test('should return empty string when decryption fails', () => {
    // Generate a salt key ID
    const saltKeyId = generateSaltKeyId();
    const testData = 'test-data-456';

    // Encrypt with a salt
    const encryptedData = encrypt(testData, saltKeyId);

    // Create a different salt key ID
    const differentSaltKeyId = generateSaltKeyId();

    // Attempting to decrypt with wrong salt should return empty string
    const result = decrypt(encryptedData, differentSaltKeyId);
    expect(result).toBe('');
  });
});
