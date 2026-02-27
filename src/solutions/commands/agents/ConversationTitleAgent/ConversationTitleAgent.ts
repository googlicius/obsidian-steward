import { generateText } from 'ai';
import { getClassifier } from 'src/lib/modelfusion';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';

interface GenerateTitleParams {
  title: string;
  query: string;
  lang?: string | null;
}

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
   * Designed to be fire-and-forget so it never blocks the main agent.
   */
  public async generate(params: GenerateTitleParams): Promise<void> {
    if (!this.plugin.settings.llm.agents.conversationTitle.enabled) {
      return;
    }

    const { title, query } = params;

    try {
      const conversationTitle = await this.resolveTitle(query);

      if (!conversationTitle) {
        return;
      }

      await this.renderer.updateConversationFrontmatter(title, [
        { name: 'conversation_title', value: conversationTitle },
        { name: 'created_at', value: new Date() },
      ]);
    } catch (error) {
      logger.error('ConversationTitleAgent failed to generate title:', error);
    }
  }

  private async resolveTitle(query: string): Promise<string | null> {
    const staticTitle = await this.tryStaticClassification(query);
    if (staticTitle) {
      return staticTitle;
    }

    return query.split(' ').length <= 10 ? query : this.generateWithLLM(query);
  }

  /**
   * Attempt to derive a title from the static/prefixed classifier clusters.
   * Returns the capitalised cluster name when a static or prefixed match is found.
   */
  private async tryStaticClassification(query: string): Promise<string | null> {
    try {
      const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
      const classifier = getClassifier(embeddingSettings, false);
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
  private async generateWithLLM(query: string): Promise<string | null> {
    try {
      const llmConfig = await this.plugin.llmService.getLLMConfig({
        generateType: 'text',
        overrideModel: this.plugin.settings.llm.agents.conversationTitle.model,
      });

      const { text } = await generateText({
        model: llmConfig.model,
        temperature: 0.3,
        maxOutputTokens: 50,
        abortSignal: this.plugin.abortService.createAbortController('conversation-title'),
        system: `Your task is to generate a short, descriptive title for a conversation based on the user's query.

ONLY generate a title that describes what the user is asking about.

DO NOT answer directly to the query.

The title must:
- Be at most 10 words
- Describe the TOPIC of the query, not answer it
- And respect the user's language.`,
        prompt: query,
      });

      const cleaned = text
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/[.!?]+$/, '');

      if (!cleaned) {
        return null;
      }

      return cleaned;
    } catch (error) {
      logger.error('ConversationTitleAgent LLM generation failed:', error);
      return null;
    }
  }
}
