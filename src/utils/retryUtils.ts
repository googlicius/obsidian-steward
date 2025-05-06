import { logger } from './logger';

/**
 * Options for the retry mechanism
 */
export interface RetryOptions<T> {
	/** Maximum number of retry attempts (default: 3) */
	maxAttempts?: number;

	/** Initial delay in milliseconds (default: 1000ms) */
	initialDelayMs?: number;

	/** Maximum delay in milliseconds (default: 30000ms) */
	maxDelayMs?: number;

	/** Whether to use exponential backoff (default: true) */
	useExponentialBackoff?: boolean;

	/** Jitter factor to randomize delay (0-1, default: 0.2) */
	jitterFactor?: number;

	/** Timeout in milliseconds for each attempt (default: no timeout) */
	timeoutMs?: number;

	/**
	 * Predicate to determine if error should trigger a retry
	 * If not provided, all errors trigger retries
	 */
	shouldRetry?: (error: any, attemptNumber: number) => boolean;

	/** Called before each retry attempt */
	onRetry?: (error: any, attemptNumber: number, delayMs: number) => void;

	/** Called when all retries fail */
	onFailure?: (error: any, attemptNumber: number) => void;

	/** Called when operation succeeds after retry */
	onSuccess?: (result: T, attemptNumber: number) => void;
}

/**
 * Wraps a promise-returning function with retry logic
 *
 * @param operation - Function that returns a promise
 * @param options - Retry configuration options
 * @returns Promise resolving to the operation result or rejecting with the last error
 */
export async function withRetry<T>(
	operation: () => Promise<T>,
	options: RetryOptions<T> = {}
): Promise<T> {
	// Initialize options with defaults
	const {
		maxAttempts = 3,
		initialDelayMs = 1000,
		maxDelayMs = 30000,
		useExponentialBackoff = true,
		jitterFactor = 0.2,
		timeoutMs,
		shouldRetry = () => true,
		onRetry,
		onFailure,
		onSuccess,
	} = options;

	let attemptNumber = 0;
	let lastError: any;

	while (attemptNumber < maxAttempts) {
		attemptNumber++;

		try {
			// Execute the operation with timeout if specified
			const result = await executeWithTimeout(operation, timeoutMs);

			// Operation succeeded
			if (onSuccess) {
				onSuccess(result, attemptNumber);
			}

			return result;
		} catch (error) {
			lastError = error;

			// Check if we should retry
			const shouldRetryThis = shouldRetry(error, attemptNumber);
			const hasMoreAttempts = attemptNumber < maxAttempts;

			if (!shouldRetryThis || !hasMoreAttempts) {
				// Don't retry
				break;
			}

			// Calculate delay with exponential backoff and jitter
			const delayMs = calculateDelay(
				attemptNumber,
				initialDelayMs,
				maxDelayMs,
				useExponentialBackoff,
				jitterFactor
			);

			// Notify before retry
			if (onRetry) {
				onRetry(error, attemptNumber, delayMs);
			} else {
				logger.log(
					`Attempt ${attemptNumber} failed. Retrying in ${delayMs}ms. Error: ${error?.message || error}`
				);
			}

			// Wait before next attempt
			await sleep(delayMs);
		}
	}

	// All attempts failed
	if (onFailure) {
		onFailure(lastError, attemptNumber);
	} else {
		logger.error(`All ${maxAttempts} retry attempts failed:`, lastError);
	}

	throw lastError;
}

/**
 * Executes a promise with an optional timeout
 */
async function executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs?: number): Promise<T> {
	if (!timeoutMs) {
		return operation();
	}

	return new Promise<T>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Operation timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		operation()
			.then(result => {
				clearTimeout(timeoutId);
				resolve(result);
			})
			.catch(error => {
				clearTimeout(timeoutId);
				reject(error);
			});
	});
}

/**
 * Calculates the delay time using exponential backoff with jitter
 */
function calculateDelay(
	attemptNumber: number,
	initialDelayMs: number,
	maxDelayMs: number,
	useExponentialBackoff: boolean,
	jitterFactor: number
): number {
	// Base delay with/without exponential backoff
	let delay = useExponentialBackoff
		? initialDelayMs * Math.pow(2, attemptNumber - 1)
		: initialDelayMs;

	// Apply maximum delay limit
	delay = Math.min(delay, maxDelayMs);

	// Apply jitter to prevent thundering herd problem
	if (jitterFactor > 0) {
		const jitterRange = delay * jitterFactor;
		delay = delay - jitterRange / 2 + Math.random() * jitterRange;
	}

	return Math.floor(delay);
}

/**
 * Sleep/wait for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a retry-wrapped version of any async function
 *
 * @param fn - The async function to wrap with retry logic
 * @param options - Retry configuration options
 * @returns A new function with retry capability
 */
export function createRetryableFunction<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	options: RetryOptions<Awaited<ReturnType<T>>> = {}
): T {
	return ((...args: Parameters<T>) => {
		return withRetry(() => fn(...args), options);
	}) as T;
}

/**
 * Creates a retry-wrapped version of the function that executes with a minimum delay
 * This is useful for background tasks that should not start immediately
 *
 * @param fn - The async function to execute with delay and retry logic
 * @param initialDelayMs - Delay before first execution attempt
 * @param options - Retry configuration options
 * @returns Promise that resolves when the operation completes
 */
export function executeWithInitialDelay<T>(
	fn: () => Promise<T>,
	initialDelayMs = 0,
	options: RetryOptions<T> = {}
): Promise<T> {
	return new Promise((resolve, reject) => {
		setTimeout(() => {
			withRetry(fn, options).then(resolve).catch(reject);
		}, initialDelayMs);
	});
}

/**
 * Specialized retry wrapper for API calls that need API keys to be loaded
 * Retries the operation when it receives authentication errors
 *
 * @param operation - Function that returns a promise
 * @param options - Retry configuration options
 * @returns Promise resolving to the operation result
 */
export function withApiRetry<T>(
	operation: () => Promise<T>,
	options: RetryOptions<T> = {}
): Promise<T> {
	// Default options specifically for API calls
	const apiRetryOptions: RetryOptions<T> = {
		maxAttempts: 5,
		initialDelayMs: 2000,
		useExponentialBackoff: true,
		// Only retry on authentication/authorization errors or rate limits
		shouldRetry: (error, attemptNumber) => {
			// Common API error patterns
			const isAuthError =
				error?.status === 401 ||
				error?.status === 403 ||
				error?.message?.includes('authentication') ||
				error?.message?.includes('API key') ||
				error?.message?.includes('auth');

			const isRateLimitError =
				error?.status === 429 ||
				error?.message?.includes('rate limit') ||
				error?.message?.includes('too many requests');

			const isNetworkError =
				error?.message?.includes('network') ||
				error?.message?.includes('timeout') ||
				error?.message?.includes('connection');

			return isAuthError || isRateLimitError || isNetworkError;
		},
		// Custom logging for API retries
		onRetry: (error, attemptNumber, delayMs) => {
			const errorType =
				error?.status === 401 || error?.status === 403
					? 'Authentication error'
					: error?.status === 429
						? 'Rate limit exceeded'
						: 'API error';

			logger.log(
				`${errorType} (attempt ${attemptNumber}). Retrying in ${delayMs}ms. ` +
					`Error: ${error?.message || error}`
			);
		},
		...options,
	};

	return withRetry(operation, apiRetryOptions);
}
