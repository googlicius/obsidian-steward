import { CommandIntent } from 'src/types/types';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';
import { STW_SELECTED_PATTERN, STW_SELECTED_PLACEHOLDER } from 'src/constants';
import { type CommandProcessor } from './CommandProcessor';

export enum CommandResultStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  NEEDS_CONFIRMATION = 'needs_confirmation',
  NEEDS_USER_INPUT = 'needs_user_input',
  LOW_CONFIDENCE = 'low_confidence',
}

export type ConfirmationCommandResult = {
  status: CommandResultStatus.NEEDS_CONFIRMATION;
  confirmationMessage?: string;
  onConfirmation: (message: string) => Promise<CommandResult> | CommandResult;
  onRejection?: (message: string) => Promise<CommandResult> | CommandResult;
  onFinal?: () => Promise<void> | void;
};

type UserInputCommandResult = {
  status: CommandResultStatus.NEEDS_USER_INPUT;
  onUserInput: (message: string) => Promise<CommandResult> | CommandResult;
};

type SuccessCommandResult = {
  status: CommandResultStatus.SUCCESS;
};

type ErrorCommandResult = {
  status: CommandResultStatus.ERROR;
  error?: Error | string;
};

type LowConfidenceCommandResult = {
  status: CommandResultStatus.LOW_CONFIDENCE;
  commandType: string;
  explanation?: string;
};

export type CommandResult =
  | ConfirmationCommandResult
  | UserInputCommandResult
  | SuccessCommandResult
  | ErrorCommandResult
  | LowConfidenceCommandResult;

export interface CommandHandlerParams<T extends CommandIntent = CommandIntent> {
  title: string;
  command: T;
  prevCommand?: CommandIntent;
  nextCommand?: CommandIntent;
  lang?: string | null;
  /**
   * Handler ID to group all messages issued in one handle function call.
   * If not provided, a new ID will be generated.
   */
  handlerId?: string;
  upstreamOptions?: {
    isReloadRequest?: boolean;
    ignoreClassify?: boolean;
  };
}

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
    // Check if model fallback is enabled
    const fallbackEnabled = this.plugin.modelFallbackService.isEnabled();

    // First, try to get the current model from the fallback state if available
    let currentModel = params.command.model || this.plugin.settings.llm.chat.model;

    if (fallbackEnabled) {
      const currentModelFromState = await this.plugin.modelFallbackService.getCurrentModel(
        params.title
      );
      if (currentModelFromState) {
        // Use the model from frontmatter if available
        currentModel = currentModelFromState;
      }
    }

    params.command.model = currentModel;

    try {
      // Call the original handle method
      return await this.handle(params, ...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in ${params.command.commandType} command handler:`, error);

      // Render the current error message
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: `*Error processing ${params.command.commandType} command: ${errorMessage}*`,
        lang: params.lang,
      });

      // If fallback is enabled, try to use fallback models
      if (fallbackEnabled) {
        // Try to switch to the next model
        const nextModel = await this.plugin.modelFallbackService.switchToNextModel(params.title);
        if (nextModel) {
          const newModel = await this.plugin.modelFallbackService.getCurrentModel(params.title);
          if (newModel) {
            // Render fallback message
            await this.renderFallbackMessage(
              params.title,
              params.command.model,
              newModel,
              params.lang
            );

            // Update command with new model
            params.command.model = newModel;

            // Try again with the new model
            logger.log(`Retrying command with fallback model: ${newModel}`);
            return this.safeHandle(params, ...args);
          }
        } else {
          // We've exhausted all models, show the error summary
          const errors = await this.plugin.modelFallbackService.getRecordedErrors(params.title);
          await this.renderAllModelsFailed(params.title, params.lang, errors);
        }
      }

      return {
        status: CommandResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Render a message indicating that we're switching to a fallback model
   */
  protected async renderFallbackMessage(
    conversationTitle: string,
    fromModel: string,
    toModel: string,
    lang?: string | null
  ): Promise<void> {
    try {
      await this.renderer.updateConversationNote({
        path: conversationTitle,
        newContent: `*Switching from ${fromModel} to ${toModel} due to errors*`,
        lang: lang,
        includeHistory: false,
      });
    } catch (error) {
      logger.error('Failed to render fallback message:', error);
    }
  }

  /**
   * Render a message with all errors when all models have failed
   */
  protected async renderAllModelsFailed(
    conversationTitle: string,
    lang?: string | null,
    errors?: Array<{ model: string; error: string }>
  ): Promise<void> {
    try {
      let message = `*All available models have failed. Please check your query or try again later.*`;

      // Add error details if available
      if (errors && errors.length > 0) {
        const errorDetails = errors
          .map(err => {
            return `- ${err.model}: ${err.error}`;
          })
          .join('\n');

        message += `\n\n${errorDetails}`;
      }

      await this.renderer.updateConversationNote({
        path: conversationTitle,
        newContent: message,
        lang: lang,
        includeHistory: false,
      });
    } catch (error) {
      logger.error('Failed to render all models failed message:', error);
    }
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
