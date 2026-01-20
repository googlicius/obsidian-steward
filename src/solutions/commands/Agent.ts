import { AgentHandlerParams, AgentResult, Intent, IntentResultStatus } from './types';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';
import { type CommandProcessor } from './CommandProcessor';
import { getTranslation } from 'src/i18n';
import { ToolName } from './ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';

export abstract class Agent {
  constructor(
    readonly plugin: StewardPlugin,
    protected activeTools: ToolName[] = []
  ) {}

  /**
   * Optional: Whether this agent requires content (boolean or function for dynamic check)
   */
  isContentRequired?: boolean | ((agentType: string) => boolean);

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
   * Render a loading indicator for the agent
   * @param title The conversation title
   * @param lang The language code
   */
  public renderIndicator?(title: string, lang?: string | null): Promise<void>;

  /**
   * Handle an agent invocation
   */
  public abstract handle(params: AgentHandlerParams, ...args: unknown[]): Promise<AgentResult>;

  /**
   * Handle an agent invocation with automatic error handling and model fallback
   */
  public async safeHandle(params: AgentHandlerParams, ...args: unknown[]): Promise<AgentResult> {
    params.intent.model = await this.getCurrentModel(params.title, params.intent);
    params.intent.query = this.plugin.userMessageService.sanitizeQuery(params.intent.query);
    params.invocationCount = params.invocationCount || 0;
    params.handlerId = params.handlerId || uniqueID();
    params.lang = params.lang || (await this.loadConversationLang(params.title));
    params.intent.use_tool = await this.loadConversationUseTool(
      params.title,
      params.intent.use_tool
    );
    params.intent.systemPrompts = await this.loadSystemPrompts(params);

    try {
      // Call the original handle method
      const result = await this.handle(params, ...args);

      if (result.status === IntentResultStatus.NEEDS_CONFIRMATION) {
        await this.renderer.showConfirmationButtons(params.title);
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && 'error' in error
            ? error.error.message
            : String(error);
      logger.error(`Error in ${params.intent.type || 'Super'} agent handler:`, error);

      const t = getTranslation(params.lang);
      // Render the current error message
      await this.renderer.updateConversationNote({
        path: params.title,
        newContent: `*${t('common.errorProcessingCommand', { commandType: params.intent.type, errorMessage })}*`,
        lang: params.lang,
        includeHistory: false,
        handlerId: params.handlerId,
      });

      const nonRetryAbleError =
        error instanceof Error &&
        ['AbortError', 'TypeError', 'SysError', 'AI_InvalidPromptError'].includes(error.name);

      if (this.plugin.modelFallbackService.isEnabled() && !nonRetryAbleError) {
        const nextModel = await this.plugin.modelFallbackService.switchToNextModel(params.title);
        if (nextModel) {
          // Render fallback message
          await this.renderer.updateConversationNote({
            path: params.title,
            newContent: `*${t('common.switchingModelDueToErrors', { fromModel: params.intent.model, toModel: nextModel })}*`,
            lang: params.lang,
            includeHistory: false,
            handlerId: params.handlerId,
          });

          // Update intent with new model
          params.intent.model = nextModel;

          // Try again with the new model
          logger.log(`Retrying agent with fallback model: ${nextModel}`);

          if (!params.handlerId) {
            logger.warn('Retrying agent with fallback model without handlerId');
          }

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
   * Load activeTools from conversation frontmatter or use default
   * @param title The conversation title
   * @param paramsActiveTools ActiveTools provided in params (if any)
   * @returns The activeTools to use (merged from params, conversation properties, and default)
   */
  protected async loadActiveTools(
    title: string,
    paramsActiveTools?: ToolName[]
  ): Promise<ToolName[]> {
    // Try to load from frontmatter
    const savedActiveTools = await this.renderer.getConversationProperty<ToolName[]>(
      title,
      'tools'
    );

    // Combine all sources: params, saved, and default
    const allTools: ToolName[] = [
      ...(paramsActiveTools || []),
      ...(savedActiveTools || []),
      ...this.activeTools,
    ];

    // Remove duplicates and return
    return Array.from(new Set(allTools));
  }

  private async loadConversationLang(
    title: string,
    paramsLang?: string | null
  ): Promise<string | null> {
    const savedLang = await this.renderer.getConversationProperty<string>(title, 'lang');
    return paramsLang || savedLang || null;
  }

  private async loadConversationUseTool(
    title: string,
    intentUseTool?: boolean
  ): Promise<boolean | undefined> {
    if (intentUseTool !== undefined) {
      return intentUseTool;
    }

    return this.renderer.getConversationProperty<boolean>(title, 'use_tool');
  }

  private async loadSystemPrompts(params: AgentHandlerParams): Promise<string[] | undefined> {
    if (params.intent.systemPrompts && params.intent.systemPrompts.length > 0) {
      return params.intent.systemPrompts;
    }

    const udcCommand = await this.renderer.getConversationProperty<string>(
      params.title,
      'udc_command'
    );
    if (!udcCommand) {
      return params.intent.systemPrompts;
    }

    const command = this.plugin.userDefinedCommandService.userDefinedCommands.get(udcCommand);
    if (!command || command.getVersion() !== 2) {
      return params.intent.systemPrompts;
    }

    const rootSystemPrompts = command.normalized.system_prompt;
    if (!rootSystemPrompts || rootSystemPrompts.length === 0) {
      return params.intent.systemPrompts;
    }

    return this.plugin.userDefinedCommandService.processSystemPromptsWikilinks(rootSystemPrompts);
  }
}
