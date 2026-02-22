import i18next from 'i18next';
import { delay } from './delay';

/**
 * Checks if a chunk boundary would split special Markdown elements
 * and adjusts the boundary to maintain their integrity
 * @param text The full text being processed
 * @param position Current position in the text
 * @param proposedEnd Proposed end position for the current chunk
 * @returns Adjusted end position that won't split special elements
 */
function adjustChunkBoundary(text: string, position: number, proposedEnd: number): number {
  let adjustedEnd = proposedEnd;

  // Check for Markdown links [[...]]
  adjustedEnd = checkAndAdjustForMarkdownLinks(text, position, adjustedEnd);

  // Additional checks can be added here in the future

  return adjustedEnd;
}

/**
 * Checks and adjusts chunk boundaries to prevent splitting Markdown links
 * @param text The full text being processed
 * @param position Current position in the text
 * @param proposedEnd Proposed end position for the current chunk
 * @returns Adjusted end position that won't split Markdown links
 */
function checkAndAdjustForMarkdownLinks(
  text: string,
  position: number,
  proposedEnd: number
): number {
  // Check if we're in the middle of a Markdown link
  const linkStartPos = text.lastIndexOf('[[', proposedEnd);
  const linkEndPos = text.indexOf(']]', linkStartPos);

  if (
    linkStartPos !== -1 &&
    linkStartPos < proposedEnd &&
    (linkEndPos === -1 || linkEndPos >= proposedEnd)
  ) {
    // We're about to split a link, so adjust the end position
    if (linkStartPos > position) {
      // Cut before the link starts
      return linkStartPos;
    } else if (linkEndPos !== -1) {
      // Include the entire link
      return linkEndPos + 2;
    }
  }

  return proposedEnd;
}

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
    const proposedEnd = Math.min(position + currentChunkSize, text.length);

    // Adjust chunk boundary to avoid splitting special elements
    const end = adjustChunkBoundary(text, position, proposedEnd);

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

/**
 * Prepend a chunk to a stream
 */
export async function* prependChunk<T>(
  firstChunk: T,
  iterator: AsyncIterator<T>
): AsyncGenerator<T> {
  yield firstChunk;
  for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
    yield chunk;
  }
}

const REASONING_START_TAG = '````stw-thinking\n';
const REASONING_END_TAG = `\n\`\`\`\`\n>[!info] <a class="stw-thinking-process">${i18next.t('common.thinkingProcess')}</a>\n\n`;

interface StreamChunk {
  type?: string;
  reasoningText?: string;
  textDelta?: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Escapes triple backticks in reasoning content to prevent breaking the stw-thinking code fence.
 * Inserts zero-width spaces between backticks to break the pattern without changing visual appearance.
 * @param text The reasoning text that may contain code blocks
 * @returns The text with triple backticks escaped
 */
function escapeTripleBackticks(text: string): string {
  // Replace ``` with `[ZWS]`[ZWS]` where ZWS is zero-width space (U+200B)
  // This breaks the triple backtick pattern to prevent markdown parsers from
  // interpreting it as a fence delimiter, while maintaining visual appearance
  const ZWS = '\u200B';
  return text.replace(/```/g, `\`${ZWS}\`${ZWS}\``);
}

/**
 * Checks if the chunk type indicates text/reasoning content
 */
function isTextOrReasoningChunk(type: string): boolean {
  return (
    type === 'reasoning-delta' || type === 'reasoning' || type === 'text-delta' || type === 'text'
  );
}

export interface ToolContentDelta {
  toolCallId: string;
  toolName: string;
  contentDelta: string;
}

interface LLMStreamResult {
  textStream: AsyncGenerator<string, void, unknown>;
  textDone: Promise<void>;
  toolContentStream: AsyncGenerator<ToolContentDelta, void, unknown>;
}

interface ToolContentStreamingConfig {
  targetTools: Set<string>;
  createExtractor: (toolName: string) => { feed: (delta: string) => string };
}

/**
 * Simple async queue for pushing items from one generator and pulling from another.
 * Used to bridge the single-consumer fullStream into two output streams.
 */
class AsyncQueue<T> {
  private queue: T[] = [];
  private resolve: (() => void) | null = null;
  private done = false;

  push(item: T): void {
    this.queue.push(item);
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  close(): void {
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  async *iterate(): AsyncGenerator<T, void, unknown> {
    while (true) {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (item !== undefined) yield item;
      }
      if (this.done) return;
      await new Promise<void>(r => {
        this.resolve = r;
      });
    }
  }
}

/**
 * Creates text/reasoning and tool-content streams from the AI SDK fullStream.
 *
 * - `textStream` yields text and reasoning content (same as the old createTextReasoningStream)
 * - `textDone` resolves when text/reasoning streaming is complete (before tool calls)
 * - `toolContentStream` yields extracted content field deltas from tool call arguments
 *   for tools listed in `toolContentStreaming.targetTools`
 *
 * Both streams are driven by the same `for await` loop over fullStream (single consumer).
 * Tool-call-delta data is pushed into a shared queue that toolContentStream reads from.
 */
export function createLLMStream(
  fullStream: AsyncIterable<unknown>,
  options?: {
    toolContentStreaming?: ToolContentStreamingConfig;
  }
): LLMStreamResult {
  let resolveTextDone: () => void;
  const textDone = new Promise<void>(resolve => {
    resolveTextDone = resolve;
  });

  const toolContentQueue = new AsyncQueue<ToolContentDelta>();
  const streamingConfig = options?.toolContentStreaming;

  // Per-tool-call extractors keyed by toolCallId
  const extractors = new Map<string, { feed: (delta: string) => string; toolName: string }>();

  let hasStartedTextOrReasoning = false;
  let hasSignaledDone = false;

  async function* textGenerator(): AsyncGenerator<string, void, unknown> {
    let reasoningStarted = false;
    let reasoningEnded = false;

    for await (const chunk of fullStream) {
      const chunkWithType = chunk as StreamChunk;

      if (!chunkWithType.type) {
        continue;
      }

      const isTextReasoning = isTextOrReasoningChunk(chunkWithType.type);

      // Signal done when we transition from text/reasoning to other chunk types
      if (hasStartedTextOrReasoning && !isTextReasoning && !hasSignaledDone) {
        if (reasoningStarted && !reasoningEnded) {
          reasoningEnded = true;
          yield REASONING_END_TAG;
        }
        hasSignaledDone = true;
        resolveTextDone();
      }

      switch (chunkWithType.type) {
        case 'reasoning-delta':
        case 'reasoning': {
          hasStartedTextOrReasoning = true;

          if (!reasoningStarted) {
            reasoningStarted = true;
            yield REASONING_START_TAG;
          }

          const reasoningText = (chunkWithType.text ||
            chunkWithType.reasoningText ||
            chunkWithType.textDelta ||
            '') as string;

          if (reasoningText && typeof reasoningText === 'string') {
            yield escapeTripleBackticks(reasoningText);
          }
          break;
        }

        case 'text-delta':
        case 'text': {
          hasStartedTextOrReasoning = true;

          if (reasoningStarted && !reasoningEnded) {
            reasoningEnded = true;
            yield REASONING_END_TAG;
          }

          const textContent = (chunkWithType.textDelta || chunkWithType.text || '') as string;
          if (textContent && typeof textContent === 'string') {
            yield textContent;
          }
          break;
        }

        case 'tool-input-start': {
          if (!streamingConfig) break;

          const toolName = chunkWithType.toolName as string;
          const toolCallId = chunkWithType.id as string;

          if (toolName && toolCallId && streamingConfig.targetTools.has(toolName)) {
            const extractor = streamingConfig.createExtractor(toolName);
            extractors.set(toolCallId, { feed: extractor.feed.bind(extractor), toolName });
          }
          break;
        }

        case 'tool-input-delta': {
          const toolCallId = chunkWithType.id as string;
          const inputTextDelta = chunkWithType.delta as string;
          const entry = toolCallId ? extractors.get(toolCallId) : undefined;

          if (entry && inputTextDelta) {
            const contentDelta = entry.feed(inputTextDelta);
            if (contentDelta) {
              toolContentQueue.push({
                toolCallId,
                toolName: entry.toolName,
                contentDelta,
              });
            }
          }
          break;
        }

        case 'tool-input-end': {
          const endToolCallId = chunkWithType.id as string;
          if (endToolCallId) {
            extractors.delete(endToolCallId);
          }
          break;
        }

        // tool-call, finish, etc. - no special handling needed
        default:
          break;
      }
    }

    // If reasoning started but never ended, close it
    if (reasoningStarted && !reasoningEnded) {
      yield REASONING_END_TAG;
    }

    if (!hasSignaledDone) {
      resolveTextDone();
    }

    // Signal the tool content queue that no more items will be pushed
    toolContentQueue.close();
  }

  return {
    textStream: textGenerator(),
    textDone,
    toolContentStream: toolContentQueue.iterate(),
  };
}
