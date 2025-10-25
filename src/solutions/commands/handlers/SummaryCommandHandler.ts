import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { generateObject } from 'ai';
import { ConversationHistoryMessage } from 'src/types/types';
import { z } from 'zod';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';

// Schema for conversation summary
const conversationSummarySchema = z.object({
  summary: z.string().describe('A concise summary text of the conversation'),
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
          lang,
        });

        return {
          status: CommandResultStatus.SUCCESS,
        };
      }

      await this.renderer.updateConversationNote({
        path: title,
        // Put placeholder to ensure it does not render in between user and steward messages
        // The `<>` won't be visible in the conversation
        newContent: '<summaryPlaceholder>',
        role: {
          name: 'Steward',
          showLabel: false,
        },
        command: 'summary',
        lang,
      });

      // Generate summary
      const summary = await this.generateSummary(conversationHistory);

      // Store the summary in the conversation note
      await this.renderer.updateConversationNote({
        path: title,
        newContent: '',
        artifactContent: `${t('summary.conversationSummary')}:\n${summary}`,
        replacePlaceHolder: '<summaryPlaceholder>',
        role: {
          name: 'Assistant',
          showLabel: false,
        },
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error generating summary: ${error.message}*`,
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
      const llmConfig = await this.plugin.llmService.getLLMConfig();

      const { object } = await generateObject({
        ...llmConfig,
        abortSignal: this.plugin.abortService.createAbortController('summary'),
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
