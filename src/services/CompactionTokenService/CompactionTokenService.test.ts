import type StewardPlugin from 'src/main';
import {
  COMPACTION_PROMPT_THRESHOLD_PERCENT,
  COMPACTION_VISIBLE_WINDOW_DEFAULT,
  COMPACTION_VISIBLE_WINDOW_MIN,
  CompactionTokenService,
  estimatePromptTokensRoughFromMessages,
} from './CompactionTokenService';

function createMockPlugin(options?: {
  contextLengthTokens?: number;
  recordedPromptTokens?: number | undefined;
}): jest.Mocked<StewardPlugin> {
  const contextLengthTokens = options?.contextLengthTokens ?? 128_000;
  const recorded = options?.recordedPromptTokens;
  return {
    llmService: {
      getModelContextLengthTokens: jest.fn().mockReturnValue(contextLengthTokens),
    },
    conversationRenderer: {
      getRecordedInputTokensForAgent: jest.fn().mockResolvedValue(recorded),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('CompactionTokenService', () => {
  describe('shouldTriggerCompactionByTokens', () => {
    let service: CompactionTokenService;
    let shouldTriggerCompactionByTokens: (params: {
      promptTokens: number;
      contextLength: number;
      thresholdPercent: number;
    }) => boolean;

    beforeEach(() => {
      service = new CompactionTokenService(createMockPlugin());
      shouldTriggerCompactionByTokens = service['shouldTriggerCompactionByTokens'].bind(service);
    });

    it('returns true at equality', () => {
      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 64_000,
          contextLength: 128_000,
          thresholdPercent: COMPACTION_PROMPT_THRESHOLD_PERCENT,
        })
      ).toBe(true);
    });

    it('returns false below threshold', () => {
      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 63_999,
          contextLength: 128_000,
          thresholdPercent: COMPACTION_PROMPT_THRESHOLD_PERCENT,
        })
      ).toBe(false);
    });

    it('clamps threshold percent to [0, 1]', () => {
      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 1,
          contextLength: 10,
          thresholdPercent: 2,
        })
      ).toBe(false);

      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 10,
          contextLength: 10,
          thresholdPercent: 2,
        })
      ).toBe(true);

      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 0,
          contextLength: 100,
          thresholdPercent: -1,
        })
      ).toBe(true);
    });
  });

  describe('resolveCompactionVisibleWindowSize', () => {
    it('shrinks window when recorded prompt tokens exceed threshold', async () => {
      const mockPlugin = createMockPlugin({ recordedPromptTokens: 70_000 });
      const service = new CompactionTokenService(mockPlugin);

      await expect(
        service.resolveCompactionVisibleWindowSize({
          conversationTitle: 't',
          conversationHistory: [],
          model: 'x',
        })
      ).resolves.toBe(Math.max(COMPACTION_VISIBLE_WINDOW_MIN, Math.floor(COMPACTION_VISIBLE_WINDOW_DEFAULT / 2)));
    });

    it('uses fallback estimate when recorded tokens missing', async () => {
      const mockPlugin = createMockPlugin({ recordedPromptTokens: undefined });
      const service = new CompactionTokenService(mockPlugin);
      const pad = 'x'.repeat(280_000);

      await expect(
        service.resolveCompactionVisibleWindowSize({
          conversationTitle: 't',
          conversationHistory: [{ role: 'user', content: pad }],
          model: 'x',
        })
      ).resolves.toBe(Math.max(COMPACTION_VISIBLE_WINDOW_MIN, Math.floor(COMPACTION_VISIBLE_WINDOW_DEFAULT / 2)));
    });

    it('returns default visible window when under threshold', async () => {
      const mockPlugin = createMockPlugin({ recordedPromptTokens: 1000 });
      const service = new CompactionTokenService(mockPlugin);

      await expect(
        service.resolveCompactionVisibleWindowSize({
          conversationTitle: 't',
          conversationHistory: [],
          model: 'x',
        })
      ).resolves.toBe(COMPACTION_VISIBLE_WINDOW_DEFAULT);
    });
  });
});

describe('estimatePromptTokensRoughFromMessages', () => {
  it('returns 0 for empty', () => {
    expect(estimatePromptTokensRoughFromMessages([])).toBe(0);
  });

  it('ceil(JSON.stringify(messages).length / 4)', () => {
    expect(
      estimatePromptTokensRoughFromMessages([{ role: 'user', content: 'abcd' }])
    ).toBe(Math.ceil(JSON.stringify([{ role: 'user', content: 'abcd' }]).length / 4));
  });
});
