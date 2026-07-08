import { createLLMStream } from './textStreamer';

describe('createLLMStream', () => {
  it('closes toolContentStream when fullStream throws', async () => {
    async function* throwingStream() {
      yield { type: 'text-delta', textDelta: 'hello' };
      throw new Error('stream failed');
    }

    const { textStream, toolContentStream } = createLLMStream(throwingStream());

    try {
      for await (const _chunk of textStream) {
        // drain until error
      }
    } catch {
      // expected
    }

    const consumePromise = (async () => {
      for await (const _delta of toolContentStream) {
        // no items expected
      }
    })();

    await expect(consumePromise).resolves.toBeUndefined();
  });
});
