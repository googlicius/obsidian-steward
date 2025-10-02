import { retry } from './retry';

// Mock the global sleep function
declare global {
  function sleep(ms: number): Promise<void>;
}

// Mock sleep function to resolve immediately
global.sleep = jest.fn().mockResolvedValue(undefined);

describe('retry', () => {
  it('should retry until max retries are reached', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('Always fails'));

    const retryPromise = retry(mockFn, { maxRetries: 2 });

    await expect(retryPromise).rejects.toThrow('Always fails');
    expect(mockFn).toHaveBeenCalledTimes(3); // Initial call + 2 retries
  });
});
