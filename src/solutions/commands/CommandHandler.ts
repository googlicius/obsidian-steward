import { CommandIntent } from 'src/types/types';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';

export enum CommandResultStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  NEEDS_CONFIRMATION = 'needs_confirmation',
  LOW_CONFIDENCE = 'low_confidence',
}

type ConfirmationCommandResult = {
  status: CommandResultStatus.NEEDS_CONFIRMATION;
  confirmationMessage?: string;
  onConfirmation: () => Promise<CommandResult> | CommandResult;
  onRejection?: () => Promise<CommandResult> | CommandResult;
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
  upstreamOptions?: {
    isReloadRequest?: boolean;
    ignoreClassify?: boolean;
  };
}

export abstract class CommandHandler {
  abstract readonly plugin: StewardPlugin;

  constructor() {
    createSafeCommandHandler(this);
  }

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

  /**
   * Render a loading indicator for the command
   * @param title The conversation title
   * @param lang The language code
   */
  public renderIndicator?(title: string, lang?: string | null): Promise<void>;

  /**
   * Handle a command
   */
  public abstract handle(params: CommandHandlerParams): Promise<CommandResult>;
}

/**
 * Create a proxied command handler that wraps the handle method with error handling
 * @param handler The command handler to wrap
 * @returns A proxied handler with automatic error handling
 */
export function createSafeCommandHandler<T extends CommandHandler>(handler: T): T {
  return new Proxy(handler, {
    get(target, prop, receiver) {
      // Only intercept the 'handle' method
      if (prop === 'handle') {
        return async function (params: CommandHandlerParams): Promise<CommandResult> {
          try {
            // Call the original handle method
            return await target.handle(params);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error(`Error in ${params.command.commandType} command handler:`, error);

            try {
              await target.renderer.updateConversationNote({
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
        };
      }

      // For all other properties, return them as-is
      return Reflect.get(target, prop, receiver);
    },
  });
}
