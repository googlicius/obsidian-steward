import { z } from 'zod/v3';
import { getClassifier } from 'src/lib/modelfusion';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import { AbortOperationKeys } from 'src/constants';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { getBundledLib } from 'src/utils/bundledLibs';
import { USAGE_AGENT_KEY } from 'src/services/ConversationRender/Frontmatter';

interface GenerateTitleParams {
  title: string;
  query: string;
}

const conversationTitleResultSchema = z.object({
  title: z.string(),
  lang: z.string().nullable(),
});

export type ConversationTitleResult = z.infer<typeof conversationTitleResultSchema>;

/**
 * Lightweight agent that generates an AI-powered conversation title
 * and stores it in the conversation note frontmatter.
 *
 * For statically classified queries the classified cluster name is used directly.
 * Otherwise the LLM produces a concise title (≤ 6 words).
 */
export class ConversationTitleAgent {
  private readonly renderer: ConversationRenderer;

  constructor(private readonly plugin: StewardPlugin) {
    this.renderer = this.plugin.conversationRenderer;
  }

  /**
   * Generate and persist a conversation title.
   */
  public async generate(params: GenerateTitleParams): Promise<ConversationTitleResult | null> {
    if (!this.plugin.settings.llm.agents.conversationTitle.enabled) {
      return null;
    }

    const { title, query } = params;

    try {
      const conversationTitleResult = await this.resolveTitle(query, title);

      if (!conversationTitleResult) {
        return null;
      }

      const frontmatterUpdates: Array<{ name: string; value: unknown }> = [
        { name: 'conversation_title', value: conversationTitleResult.title },
        { name: 'created_at', value: new Date() },
      ];

      if (conversationTitleResult.lang) {
        frontmatterUpdates.push({ name: 'lang', value: conversationTitleResult.lang });
      }

      await this.renderer.updateConversationFrontmatter(title, frontmatterUpdates);
      return conversationTitleResult;
    } catch (error) {
      logger.error('ConversationTitleAgent failed to generate title:', error);
      return null;
    }
  }

  private async resolveTitle(
    query: string,
    conversationTitle: string
  ): Promise<ConversationTitleResult | null> {
    const staticTitle = await this.tryStaticClassification(query);
    if (staticTitle) {
      return {
        title: staticTitle,
        lang: null,
      };
    }

    if (query.split(' ').length <= 10) {
      return {
        title: query,
        lang: null,
      };
    }

    const generated = await this.generateWithLLM(query, conversationTitle);
    if (generated) {
      return generated;
    }
    return null;
  }

  /**
   * Attempt to derive a title from the static/prefixed classifier clusters.
   * Returns the capitalised cluster name when a static or prefixed match is found.
   */
  private async tryStaticClassification(query: string): Promise<string | null> {
    try {
      const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
      const classifier = await getClassifier(embeddingSettings, false);
      const result = await classifier.doClassify(query, { ignoreEmbedding: true });

      if (!result) {
        return null;
      }

      if (result.matchType === 'static' || result.matchType === 'prefixed') {
        return this.formatClusterName(result.name);
      }

      return null;
    } catch (error) {
      logger.error('ConversationTitleAgent static classification failed:', error);
      return null;
    }
  }

  private formatClusterName(name: string): string {
    return name
      .split(/[_:]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  /**
   * Ask the LLM for a concise, descriptive conversation title.
   */
  private async generateWithLLM(
    query: string,
    conversationTitle: string
  ): Promise<ConversationTitleResult | null> {
    try {
      const llmConfig = await this.plugin.llmService.getLLMConfig({
        generateType: 'text',
        overrideModel: this.plugin.settings.llm.agents.conversationTitle.model,
      });

      const { generateText, Output } = await getBundledLib('ai');

      const result = await generateText({
        model: llmConfig.model,
        temperature: 0.3,
        maxOutputTokens: 50,
        abortSignal: this.plugin.abortService.createAbortController(
          conversationTitle,
          AbortOperationKeys.CONVERSATION_TITLE
        ),
        system: `Generate a short conversation title and detect the user's language.

Return a JSON object with:
- title: a concise title (max 10 words) describing the topic, not the answer, respect the user's language.
- lang: the detected language code (for example "en", "vi", "ja"), or null if unclear

Do not include any extra keys.`,
        prompt: query,
        output: Output.object({
          schema: conversationTitleResultSchema,
          name: 'ConversationTitleResult',
        }),
      });

      try {
        await this.renderer.recordTokenUsage(
          conversationTitle,
          USAGE_AGENT_KEY.title,
          result.usage,
          result.totalUsage
        );
      } catch (usageError) {
        logger.error('Failed to record ConversationTitleAgent token usage', usageError);
      }

      const cleaned = result.output.title
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[.!?]+$/, '');

      if (!cleaned) {
        return null;
      }

      const detectedLang = result.output.lang?.trim().toLowerCase() || null;

      return {
        title: cleaned,
        lang: detectedLang,
      };
    } catch (error) {
      logger.error('ConversationTitleAgent LLM generation failed:', error);
      return null;
    }
  }
}
