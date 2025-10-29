import { CommandIntent } from 'src/types/types';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';
import {
  SELECTED_MODEL_PATTERN,
  STW_SELECTED_PATTERN,
  STW_SELECTED_PLACEHOLDER,
} from 'src/constants';
import { type CommandProcessor } from './CommandProcessor';
import { getTranslation } from 'src/i18n';

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
    params.command.model = await this.getCurrentModel(params.title, params.command);
    params.command.query = this.sanitizeQuery(params.command.query);

    try {
      // Call the original handle method
      return await this.handle(params, ...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error in ${params.command.commandType} command handler:`, error);

      const t = getTranslation(params.lang);
      // Render the current error message
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: `*${t('common.errorProcessingCommand', { commandType: params.command.commandType, errorMessage })}*`,
        lang: params.lang,
        includeHistory: false,
      });

      const isAbortError = error instanceof Error && error.name === 'AbortError';

      if (this.plugin.modelFallbackService.isEnabled() && !isAbortError) {
        const nextModel = await this.plugin.modelFallbackService.switchToNextModel(params.title);
        if (nextModel) {
          // Render fallback message
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: `*${t('common.switchingModelDueToErrors', { fromModel: params.command.model, toModel: nextModel })}*`,
            lang: params.lang,
            includeHistory: false,
          });

          // Update command with new model
          params.command.model = nextModel;

          // Try again with the new model
          logger.log(`Retrying command with fallback model: ${nextModel}`);
          return this.safeHandle(params, ...args);
        }
      }

      return {
        status: CommandResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Get current model from the command or frontmatter.
   */
  private async getCurrentModel(title: string, command: CommandIntent) {
    // Check if model fallback is enabled
    const fallbackEnabled = this.plugin.modelFallbackService.isEnabled();
    const modelPromise = this.renderer.getConversationProperty<string>(title, 'model');

    // First, try to get the current model from the fallback state if available
    let currentModel = command.model || (await modelPromise);

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
   * Sanitize the query by removing the selected model pattern.
   */
  private sanitizeQuery(query: string) {
    const regex = new RegExp(SELECTED_MODEL_PATTERN, 'gi');
    let match;
    while ((match = regex.exec(query)) !== null) {
      query = query.replace(match[0], '');
    }
    return query;
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
