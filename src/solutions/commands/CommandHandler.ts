import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';
import { STW_SELECTED_PATTERN, STW_SELECTED_PLACEHOLDER } from 'src/constants';
import { type CommandProcessor } from './CommandProcessor';
import { getTranslation } from 'src/i18n';
import { AgentHandlerParams, AgentResult, Intent, IntentResultStatus } from './types';

export type CommandHandlerParams<T extends Intent = Intent> = AgentHandlerParams<T>;
export type CommandResult = AgentResult;

export abstract class CommandHandler {
  abstract readonly plugin: StewardPlugin;

  /**
   * Optional: Whether this command requires content (boolean or function for dynamic check)
   */
  isContentRequired?: boolean | ((commandType: string) => boolean);

  get renderer(): ConversationRenderer {
    return this.plugin.conversationRenderer;
  }

  get obsidianAPITools(): ObsidianAPITools {
    return this.plugin.obsidianAPITools;
  }

  get app(): App {
    return this.plugin.app;
  }

  get settings(): StewardPluginSettings {
    return this.plugin.settings;
  }

  get commandProcessor(): CommandProcessor {
    return this.plugin.commandProcessorService.commandProcessor;
  }

  /**
   * Render a loading indicator for the command
   * @param title The conversation title
   * @param lang The language code
   */
  public renderIndicator?(title: string, lang?: string | null): Promise<void>;

  /**
   * Handle a command
   */
  public abstract handle(params: CommandHandlerParams, ...args: unknown[]): Promise<CommandResult>;

  /**
   * Handle a command with automatic error handling and model fallback
   */
  public async safeHandle(
    params: CommandHandlerParams,
    ...args: unknown[]
  ): Promise<CommandResult> {
    params.intent.model = await this.getCurrentModel(params.title, params.intent);
    params.intent.query = this.plugin.userMessageService.sanitizeQuery(params.intent.query);

    try {
      // Call the original handle method
      return await this.handle(params, ...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in ${params.intent.type} command handler:`, error);

      const t = getTranslation(params.lang);
      // Render the current error message
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: `*${t('common.errorProcessingCommand', { commandType: params.intent.type, errorMessage })}*`,
        lang: params.lang,
        includeHistory: false,
      });

      const nonRetryAbleError =
        error instanceof Error && ['AbortError', 'TypeError'].includes(error.name);

      if (this.plugin.modelFallbackService.isEnabled() && !nonRetryAbleError) {
        const nextModel = await this.plugin.modelFallbackService.switchToNextModel(params.title);
        if (nextModel) {
          // Render fallback message
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: `*${t('common.switchingModelDueToErrors', { fromModel: params.intent.model, toModel: nextModel })}*`,
            lang: params.lang,
            includeHistory: false,
          });

          // Update intent with new model
          params.intent.model = nextModel;

          // Try again with the new model
          logger.log(`Retrying command with fallback model: ${nextModel}`);
          return this.safeHandle(params, ...args);
        }
      }

      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Get current model from the intent or frontmatter.
   */
  private async getCurrentModel(title: string, intent: Intent) {
    // Check if model fallback is enabled
    const fallbackEnabled = this.plugin.modelFallbackService.isEnabled();
    const modelPromise = this.renderer.getConversationProperty<string>(title, 'model');

    // First, try to get the current model from the fallback state if available
    let currentModel = intent.model || (await modelPromise);

    if (fallbackEnabled) {
      const currentModelFromState = await this.plugin.modelFallbackService.getCurrentModel(title);
      if (currentModelFromState) {
        // Use the model from frontmatter if available
        currentModel = currentModelFromState;
      }
    }

    return currentModel;
  }

  /**
   * Restores stw-selected blocks from the original query to the processed command query.
   */
  protected restoreStwSelectedBlocks(params: {
    originalQuery: string | undefined;
    query: string;
  }): string {
    const { originalQuery, query } = params;

    if (!originalQuery) {
      return query;
    }

    if (!originalQuery.includes('{{stw-selected')) {
      return query;
    }

    if (!query.includes(STW_SELECTED_PLACEHOLDER)) {
      return query;
    }

    const stwSelectedBlocks = Array.from(
      originalQuery.matchAll(new RegExp(STW_SELECTED_PATTERN, 'g'))
    );

    if (stwSelectedBlocks.length === 0) {
      return query;
    }

    let updatedQuery = query;
    // Replace all instances of <stwSelected> with the actual stw-selected blocks
    for (const match of stwSelectedBlocks) {
      updatedQuery = updatedQuery.replace(STW_SELECTED_PLACEHOLDER, match[0]);
    }

    return updatedQuery;
  }
}
