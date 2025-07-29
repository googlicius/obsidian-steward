import * as CryptoJS from 'crypto-js';
import { logger } from './logger';

/**
 * Generates a unique identifier for use as a localStorage key
 * @returns A random string ID
 */
export function generateSaltKeyId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Gets the encryption salt from localStorage
 * @param saltKeyId - The key identifier for the salt
 * @returns The salt value or a default if not found
 */
export function getEncryptionSalt(saltKeyId: string): string {
  try {
    // Try to get the salt from localStorage
    const salt = localStorage.getItem(saltKeyId);

    // If the salt exists, return it
    if (salt) {
      return salt;
    }
  } catch (error) {
    logger.error('Failed to retrieve encryption salt from localStorage', error);
  }

  // Generate a new random salt
  const newSalt = CryptoJS.lib.WordArray.random(128 / 8).toString();

  // Store the salt in localStorage
  try {
    localStorage.setItem(saltKeyId, newSalt);
  } catch (error) {
    logger.error('Failed to store encryption salt in localStorage', error);
  }

  return newSalt;
}

/**
 * Encrypts sensitive data using AES encryption
 * @param data - The data to encrypt
 * @param saltKeyId - The key identifier for the salt in localStorage
 * @returns The encrypted data as a string
 */
export function encrypt(data: string, saltKeyId: string): string {
  if (!data) return '';

  try {
    // Get the salt from localStorage
    const salt = getEncryptionSalt(saltKeyId);

    // Create a device-specific encryption key
    const encryptionKey = generateEncryptionKey(salt);

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
export function decrypt(encryptedData: string, saltKeyId: string): string {
  if (!encryptedData) return '';

  try {
    // Get the salt from localStorage
    const salt = getEncryptionSalt(saltKeyId);

    // Create the same device-specific encryption key
    const encryptionKey = generateEncryptionKey(salt);

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

/**
 * Generates a encryption key
 * @param salt - Salt value to use for encryption
 * @returns A unique encryption key
 */
function generateEncryptionKey(salt: string): string {
  return CryptoJS.SHA256(salt).toString();
}
