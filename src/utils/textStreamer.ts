import { delay } from './delay';

/**
 * Creates an async generator that simulates streaming text by yielding chunks
 * with configurable delay and chunk size
 * @param text The full text to stream
 * @param options Configuration options for streaming
 * @returns AsyncGenerator that yields text chunks
 */
export async function* createTextStream(
	text: string,
	options: {
		chunkSize?: number;
		delayMs?: number;
		randomizeDelay?: boolean;
		randomizeChunkSize?: boolean;
	} = {}
): AsyncGenerator<string, void, unknown> {
	// Default options
	const { chunkSize = 5, delayMs = 20, randomizeDelay = true, randomizeChunkSize = true } = options;

	// Return early if text is empty
	if (!text) return;

	let position = 0;

	while (position < text.length) {
		// Calculate current chunk size (randomized if enabled)
		const currentChunkSize = randomizeChunkSize
			? Math.max(1, Math.floor(Math.random() * chunkSize * 2))
			: chunkSize;

		// Calculate current delay (randomized if enabled)
		const currentDelay = randomizeDelay
			? Math.max(5, Math.floor(Math.random() * delayMs * 1.5))
			: delayMs;

		// Get the next chunk end position
		let end = Math.min(position + currentChunkSize, text.length);

		// Check if we're in the middle of a Markdown link
		const linkStartPos = text.lastIndexOf('[[', end);
		const linkEndPos = text.indexOf(']]', linkStartPos);

		if (linkStartPos !== -1 && linkStartPos < end && (linkEndPos === -1 || linkEndPos >= end)) {
			// We're about to split a link, so adjust the end position
			if (linkStartPos > position) {
				// Cut before the link starts
				end = linkStartPos;
			} else if (linkEndPos !== -1) {
				// Include the entire link
				end = linkEndPos + 2;
			}
		}

		// Get the chunk
		const chunk = text.substring(position, end);

		// Wait before yielding the chunk
		await delay(currentDelay);

		// Yield the chunk
		yield chunk;

		// Move to next position
		position = end;
	}
}

/**
 * Creates a mock AsyncIterable that simulates a streaming response
 * Useful for testing streaming functionality
 * @param text The full text to stream
 * @param options Streaming configuration options
 * @returns AsyncIterable<string> that can be used with streaming functions
 */
export function createMockStreamResponse(
	text: string,
	options: {
		chunkSize?: number;
		delayMs?: number;
		randomizeDelay?: boolean;
		randomizeChunkSize?: boolean;
	} = {}
): AsyncIterable<string> {
	// Return an object that implements AsyncIterable
	return {
		[Symbol.asyncIterator]() {
			return createTextStream(text, options);
		},
	};
}
