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
  LOW_CONFIDENCE = 'low_confidence',
}

type ConfirmationCommandResult = {
  status: CommandResultStatus.NEEDS_CONFIRMATION;
  confirmationMessage?: string;
  onConfirmation: (message: string) => Promise<CommandResult> | CommandResult;
  onRejection?: (message: string) => Promise<CommandResult> | CommandResult;
  onFinal?: () => Promise<void> | void;
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
   * Handle a command with automatic error handling
   */
  public async safeHandle(
    params: CommandHandlerParams,
    ...args: unknown[]
  ): Promise<CommandResult> {
    try {
      // Call the original handle method
      return await this.handle(params, ...args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`Error in ${params.command.commandType} command handler:`, error);

      try {
        await this.renderer.updateConversationNote({
          path: params.title,
          newContent: `*Error processing ${params.command.commandType} command: ${errorMessage}*`,
          lang: params.lang,
        });
      } catch (renderError) {
        logger.error('Failed to render error message to conversation:', renderError);
      }

      return {
        status: CommandResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
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
