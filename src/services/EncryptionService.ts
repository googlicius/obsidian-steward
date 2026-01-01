import * as CryptoJS from 'crypto-js';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import type { ProviderNeedApiKey } from 'src/constants';

/**
 * Service for handling encryption and decryption using vault-specific storage
 */
export class EncryptionService {
  private static instance: EncryptionService;

  private constructor(private plugin: StewardPlugin) {}

  /**
   * Get the singleton instance of the EncryptionService
   */
  public static getInstance(plugin?: StewardPlugin): EncryptionService {
    if (plugin) {
      EncryptionService.instance = new EncryptionService(plugin);
      return EncryptionService.instance;
    }
    if (!EncryptionService.instance) {
      throw new Error('EncryptionService not initialized');
    }
    return EncryptionService.instance;
  }

  /**
   * Gets the encryption salt from vault-specific storage
   * @param saltKeyId - The key identifier for the salt
   * @returns The salt value or a newly generated one if not found
   */
  private getEncryptionSalt(saltKeyId: string): string {
    // Try to get the salt from vault-specific localStorage
    const salt = this.plugin.app.loadLocalStorage(saltKeyId);

    if (salt) {
      return salt;
    }

    // MIGRATION: Check if salt exists in old global localStorage
    const legacySalt = localStorage.getItem(saltKeyId);
    if (legacySalt) {
      logger.log('Migrating encryption salt from global localStorage to vault-specific storage');

      // Migrate to vault-specific storage
      this.plugin.app.saveLocalStorage(saltKeyId, legacySalt);
      localStorage.removeItem(saltKeyId);

      return legacySalt;
    }

    // Generate a new random salt
    const newSalt = CryptoJS.lib.WordArray.random(128 / 8).toString();

    // Store the salt in vault-specific localStorage
    this.plugin.app.saveLocalStorage(saltKeyId, newSalt);

    return newSalt;
  }

  /**
   * Encrypts sensitive data using AES encryption
   * @param data - The data to encrypt
   * @param saltKeyId - The key identifier for the salt in localStorage
   * @returns The encrypted data as a string
   */
  public encrypt(data: string, saltKeyId: string): string {
    if (!data) {
      return '';
    }

    try {
      // Get the salt from vault-specific localStorage
      const salt = this.getEncryptionSalt(saltKeyId);

      // Create a device-specific encryption key
      const encryptionKey = this.generateEncryptionKey(salt);

      // Encrypt the data
      return CryptoJS.AES.encrypt(data, encryptionKey).toString();
    } catch (error) {
      logger.error('Failed to encrypt data:', error);
      return '';
    }
  }

  /**
   * Decrypts encrypted data
   * @param encryptedData - The encrypted data
   * @param saltKeyId - The key identifier for the salt in localStorage
   * @returns The decrypted data or empty string if decryption fails
   */
  public decrypt(encryptedData: string, saltKeyId: string): string {
    if (!encryptedData) {
      return '';
    }

    try {
      // Get the salt from vault-specific localStorage (with migration support)
      const salt = this.getEncryptionSalt(saltKeyId);

      // Create the same device-specific encryption key
      const encryptionKey = this.generateEncryptionKey(salt);

      // Decrypt the data
      const bytes = CryptoJS.AES.decrypt(encryptedData, encryptionKey);
      const decryptedText = bytes.toString(CryptoJS.enc.Utf8);

      // Verify we have valid UTF-8 data
      if (decryptedText) {
        return decryptedText;
      }

      throw new Error('Decryption produced invalid UTF-8 data');
    } catch (error) {
      logger.error('Failed to decrypt data:', error);
      return '';
    }
  }

  public removeEncryptionSalt(saltKeyId: string): void {
    this.plugin.app.saveLocalStorage(saltKeyId, null);
    logger.log(`Removed encryption salt with key: ${saltKeyId}`);
  }

  /**
   * Get the decrypted API key for a specific provider
   * @param provider - The provider to get the API key for (e.g., 'openai', 'elevenlabs', 'deepseek', 'google', 'groq')
   * @returns The decrypted API key or empty string if not set
   */
  public getDecryptedApiKey(provider: string): string {
    if (!this.plugin.settings.providers[provider]) {
      return '';
    }

    const encryptedKey = this.plugin.settings.providers[provider].apiKey;

    if (!encryptedKey) {
      return '';
    }

    try {
      return this.decrypt(encryptedKey, this.plugin.settings.saltKeyId);
    } catch (error) {
      throw new Error(`Could not decrypt ${provider} API key`);
    }
  }

  /**
   * Securely set and encrypt an API key for a specific provider
   * @param provider - The provider to set the API key for (e.g., 'openai', 'elevenlabs', 'deepseek', 'google', 'groq')
   * @param apiKey - The API key to encrypt and store
   */
  public async setEncryptedApiKey(provider: string, apiKey: string): Promise<void> {
    try {
      // Ensure provider config exists
      if (!this.plugin.settings.providers[provider]) {
        this.plugin.settings.providers[provider] = {
          apiKey: '',
        };
      }

      // First encrypt the API key
      const encryptedKey = apiKey ? this.encrypt(apiKey, this.plugin.settings.saltKeyId) : '';

      // Update settings
      this.plugin.settings.providers[provider].apiKey = encryptedKey;

      // Save the settings
      await this.plugin.saveSettings();

      logger.log(`API key for ${provider} has been encrypted and saved`);
    } catch (error) {
      throw new Error(`Could not encrypt ${provider} API key`);
    }
  }

  /**
   * Generates an encryption key
   * @param salt - Salt value to use for encryption
   * @returns A unique encryption key
   */
  private generateEncryptionKey(salt: string): string {
    return CryptoJS.SHA256(salt).toString();
  }
}
