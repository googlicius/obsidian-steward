import type { ModelMessage } from 'ai';
import type StewardPlugin from 'src/main';
import { USAGE_AGENT_KEY } from 'src/services/ConversationRender';

/** Visible history window before token-pressure shrinking (pairs with CompactionOrchestrator default). */
export const COMPACTION_VISIBLE_WINDOW_DEFAULT = 10;

/** Minimum visible messages when shrinking under token pressure. */
export const COMPACTION_VISIBLE_WINDOW_MIN = 4;

/** Hermes-like preflight: compact harder once prompt tokens reach this fraction of context. */
export const COMPACTION_PROMPT_THRESHOLD_PERCENT = 0.5;

export function estimatePromptTokensRoughFromMessages(messages: ModelMessage[]): number {
  if (!messages.length) {
    return 0;
  }
  const chars = JSON.stringify(messages).length;
  return Math.ceil(chars / 4);
}

export class CompactionTokenService {
  constructor(private readonly plugin: StewardPlugin) {}

  private shouldTriggerCompactionByTokens(params: {
    promptTokens: number;
    contextLength: number;
    thresholdPercent: number;
  }): boolean {
    const { promptTokens, contextLength, thresholdPercent } = params;
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(contextLength) ||
      contextLength <= 0 ||
      !Number.isFinite(thresholdPercent)
    ) {
      return false;
    }
    const pct = Math.min(1, Math.max(0, thresholdPercent));
    const threshold = contextLength * pct;
    return promptTokens >= threshold;
  }

  /**
   * Visible message window passed to compaction — narrows when last prompt usage exceeds
   * {@link COMPACTION_PROMPT_THRESHOLD_PERCENT} of the resolved model context length.
   */
  public async resolveCompactionVisibleWindowSize(params: {
    conversationTitle: string;
    conversationHistory: ModelMessage[];
    model: string;
  }): Promise<number> {
    const { conversationTitle, conversationHistory, model } = params;

    const contextLengthTokens = this.plugin.llmService.getModelContextLengthTokens(model);
    const recordedPromptTokens = await this.plugin.conversationRenderer.getRecordedInputTokensForAgent(
      conversationTitle,
      USAGE_AGENT_KEY.super
    );
    const fallbackEstimatedPromptTokens =
      estimatePromptTokensRoughFromMessages(conversationHistory);

    const promptTokens =
      recordedPromptTokens !== undefined ? recordedPromptTokens : fallbackEstimatedPromptTokens;

    const overBudget = this.shouldTriggerCompactionByTokens({
      promptTokens,
      contextLength: contextLengthTokens,
      thresholdPercent: COMPACTION_PROMPT_THRESHOLD_PERCENT,
    });

    if (!overBudget) {
      return COMPACTION_VISIBLE_WINDOW_DEFAULT;
    }

    return Math.max(
      COMPACTION_VISIBLE_WINDOW_MIN,
      Math.floor(COMPACTION_VISIBLE_WINDOW_DEFAULT / 2)
    );
  }
}
