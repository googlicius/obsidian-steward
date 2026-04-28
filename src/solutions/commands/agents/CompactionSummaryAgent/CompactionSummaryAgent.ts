import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { AbortOperationKeys } from 'src/constants';
import { logger } from 'src/utils/logger';
import { getBundledLib } from 'src/utils/bundledLibs';

const MAX_SUMMARY_WORDS = 80;

const summarizationResultSchema = z.object({
  results: z.array(
    z.object({
      messageId: z.string(),
      text: z.string(),
      type: z.enum(['summarized', 'deleted']),
    })
  ),
});

export type SummarizationResultItem = z.infer<typeof summarizationResultSchema>['results'][number];

/**
 * Dedicated async agent for summarizing long assistant-generated messages.
 * It never blocks the main SuperAgent flow.
 */
export class CompactionSummaryAgent {
  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Batch-summarize multiple messages in a single LLM call.
   * Returns structured results: summarized (1-3 sentence summary) or deleted (procedural filler).
   */
  public async summarizeMessagesBatch(params: {
    conversationTitle: string;
    items: Array<{ messageId: string; content: string }>;
    lang?: string | null;
  }): Promise<SummarizationResultItem[]> {
    if (!this.plugin.settings.llm.agents.compactionSummary.enabled) return [];

    const { items } = params;
    if (items.length === 0) return [];

    try {
      const llmConfig = await this.plugin.llmService.getLLMConfig({
        generateType: 'text',
        overrideModel: this.plugin.settings.llm.agents.compactionSummary.model,
      });

      const { generateText, Output } = await getBundledLib('ai');

      const promptItems = items
        .map(
          (item, idx) =>
            `--- Message ${idx + 1} (messageId: ${item.messageId}) ---\n${item.content}`
        )
        .join('\n\n');

      const result = await generateText({
        model: llmConfig.model,
        temperature: 0.2,
        maxOutputTokens: Math.min(600, 150 * items.length),
        abortSignal: this.plugin.abortService.createAbortController(
          params.conversationTitle,
          AbortOperationKeys.COMPACTION_SUMMARY
        ),
        system: `You are summarizing assistant messages for conversation compaction.
For each message:
- If it has meaningful content (facts, decisions, explanations), output type "summarized" with a 1-3 sentence summary. Keep the summary at or below ${MAX_SUMMARY_WORDS} words. Preserve factual details and entities.
- If it is only procedural filler (e.g. "I'll read the content for you", "Let me search", acknowledgments with no substance), output type "deleted" with empty text.
Return exactly one result per message in the same order. Each result must have messageId, text, and type.`,
        prompt: `Summarize or mark as deleted:\n\n${promptItems}`,
        output: Output.object({
          schema: summarizationResultSchema,
          name: 'SummarizationResults',
        }),
      });

      const output = result.output.results ?? [];
      const normalizedResults: SummarizationResultItem[] = [];
      for (const item of output) {
        if (item.type !== 'summarized') {
          normalizedResults.push({ ...item, text: '' });
          continue;
        }
        normalizedResults.push(item);
      }

      return normalizedResults;
    } catch (error) {
      logger.error('CompactionSummaryAgent: batch summarization failed', error);
      return [];
    }
  }
}
