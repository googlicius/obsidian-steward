import { CommandIntent } from '../../lib/modelfusion/extractions';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationArtifactManager } from 'src/services/ConversationArtifactManager';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';

export enum CommandResultStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  NEEDS_CONFIRMATION = 'needs_confirmation',
}

export interface CommandResult {
  status: CommandResultStatus;
  error?: Error | string;
  confirmationMessage?: string;
  onConfirmation?: () => Promise<CommandResult> | CommandResult;
  onRejection?: () => Promise<CommandResult> | CommandResult;
}

export interface CommandHandlerParams {
  title: string;
  command: CommandIntent;
  prevCommand?: CommandIntent;
  nextCommand?: CommandIntent;
  lang?: string;
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

  get artifactManager(): ConversationArtifactManager {
    return this.plugin.artifactManager;
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
  public renderIndicator?(title: string, lang?: string): Promise<void>;

  /**
   * Handle a command
   */
  public abstract handle(params: CommandHandlerParams): Promise<CommandResult>;
}
