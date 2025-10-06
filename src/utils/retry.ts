import { logger } from './logger';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds */
  initialDelay?: number;
  /** Maximum delay between retries in milliseconds */
  maxDelay?: number;
  /** Whether to use exponential backoff */
  useExponentialBackoff?: boolean;
  /** Minimum delay between retries in milliseconds */
  minDelay?: number;
}

/**
 * Default retry options
 */
const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  useExponentialBackoff: true,
  minDelay: 100, // Minimum delay of 100ms between retries
};

/**
 * Retry a function with configurable options
 * @param fn Function to retry
 * @param options Retry configuration options
 * @returns Result of the function call
 */
export async function retry<T>(fn: () => Promise<T> | T, options: RetryOptions = {}): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = Math.max(config.initialDelay, config.minDelay);

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      logger.log(`Retry attempt ${attempt + 1} of ${config.maxRetries}`);
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxRetries) {
        throw lastError;
      }

      if (config.useExponentialBackoff) {
        delay = Math.min(Math.max(delay * 2, config.minDelay), config.maxDelay);
      }

      await sleep(delay);
    }
  }

  // This should never be reached due to the throw in the loop
  throw lastError;
}
