/**
 * Create a promise that resolves when the error is null or the max attempts are reached.
 */
export function waitForError(
  getError: () => Error | null,
  options?: {
    intervalMs?: number;
    maxAttempts?: number;
  }
): Promise<void> {
  const { intervalMs = 1000, maxAttempts = 10 } = options || {};

  return new Promise((resolve, reject) => {
    // Define a bucket to ensure the timer will eventually be cleared.
    let bucket = maxAttempts;
    const timer = window.setInterval(() => {
      bucket--;
      const error = getError();
      if (error) {
        reject(error);
        clearInterval(timer);
      }
      // If the bucket is empty and no error, resolve it.
      if (bucket <= 0) {
        resolve(undefined);
        clearInterval(timer);
      }
    }, intervalMs);
  });
}
