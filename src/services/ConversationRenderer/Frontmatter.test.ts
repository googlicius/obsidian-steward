import { Frontmatter } from './Frontmatter';

describe('Frontmatter', () => {
  const frontmatter = new Frontmatter();

  describe('extractLastStepUsageFromFrontmatter', () => {
    it('reads nested usage from agent frontmatter blocks', () => {
      const usage = frontmatter.extractLastStepUsageFromFrontmatter({
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        totalUsage: { inputTokens: 500, outputTokens: 80, totalTokens: 580 },
      });

      expect(usage?.inputTokens).toBe(100);
    });

    it('reads flat usage snapshots', () => {
      const usage = frontmatter.extractLastStepUsageFromFrontmatter({
        inputTokens: 42,
        outputTokens: 7,
        totalTokens: 49,
      });

      expect(usage?.totalTokens).toBe(49);
    });
  });

  describe('formatTokenUsageSummary', () => {
    it('joins translated usage parts', () => {
      const summary = frontmatter.formatTokenUsageSummary(
        {
          inputTokens: 12_000,
          outputTokens: 1_200,
          totalTokens: 13_200,
          inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: 8_000,
            cacheWriteTokens: undefined,
          },
          outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: undefined,
          },
        },
        'en'
      );

      expect(summary).toContain('translated_conversation.tokenUsageInput');
      expect(summary).toContain('translated_conversation.tokenUsageOutput');
      expect(summary).toContain('translated_conversation.tokenUsageCached');
      expect(summary).not.toContain('translated_conversation.tokenUsageTotal');
      expect(summary.split(' · ')).toHaveLength(3);
    });
  });
});
