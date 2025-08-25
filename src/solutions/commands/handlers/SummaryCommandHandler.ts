import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { generateObject } from 'ai';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { ConversationHistoryMessage } from 'src/types/types';
import { z } from 'zod';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

const abortService = AbortService.getInstance();

// Schema for conversation summary
const conversationSummarySchema = z.object({
  summary: z.string().describe('A concise summary of the conversation'),
});

export class SummaryCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the summary command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.summarizing'));
  }

  /**
   * Handle a summary command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, lang } = params;
    const t = getTranslation(lang);

    try {
      // Get conversation history
      const conversationHistory = await this.renderer.extractConversationHistory(title);

      if (conversationHistory.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: `*${t('summary.noConversation')}*`,
          role: 'System',
          lang,
        });

        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

      // Generate summary
      const summary = await this.generateSummary(conversationHistory);

      // Store the summary in the conversation note
      await this.renderer.updateConversationNote({
        path: title,
        newContent: '',
        role: 'System',
        command: 'summary',
        artifactContent: `${t('summary.conversationSummary')}:\n${summary}`,
        lang,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error generating summary: ${error.message}*`,
        role: 'System',
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  /**
   * Generate a summary of the conversation using LLM
   */
  private async generateSummary(
    conversationHistory: ConversationHistoryMessage[]
  ): Promise<string> {
    try {
      const llmConfig = await LLMService.getInstance().getLLMConfig();

      const { object } = await generateObject({
        ...llmConfig,
        abortSignal: abortService.createAbortController('summary'),
        system: `You are a conversation summarizer that creates concise, informative summaries of conversations.
Your task is to create a summary of the conversation that:
1. Captures the main topics and key points discussed
2. Includes important decisions or conclusions reached
3. Is concise but comprehensive
4. Is formatted in markdown with clear structure
5. Does not include unnecessary details or pleasantries

The summary will be used to provide context for future parts of the conversation and to help manage token usage.`,
        messages: [
          {
            role: 'user',
            content: `Please summarize the following conversation:\n\n${conversationHistory
              .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
              .join('\n\n')}`,
          },
        ],
        schema: conversationSummarySchema,
      });

      return object.summary;
    } catch (error) {
      logger.error('Error generating summary:', error);
      throw error;
    }
  }
}
