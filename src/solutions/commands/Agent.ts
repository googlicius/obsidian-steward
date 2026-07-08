import {
  AgentHandlerParams,
  AgentResult,
  ExtraCorePromptSection,
  Intent,
  IntentResultStatus,
} from './types';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { App } from 'obsidian';
import type StewardPlugin from '../../main';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';
import type { IntentProcessor } from './IntentProcessor';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { ToolName, ToolRegistry } from './ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { getCaughtErrorMessage } from 'src/utils/errors';

const { getTranslation } = getBundledInternal('i18n');

export interface AgentCorePromptContext {
  /** Tool registry for this turn: drives active/inactive tool sections and per-tool guidelines in the core prompt. */
  readonly registry: ToolRegistry<unknown>;
  /**if any; anchors “current file” context. */
  readonly currentNote: string | null;
  /** 0-based line of the cursor in `currentNote`, when the editor is focused on that note. */
  readonly currentPosition: number | null;
  /** When true, include the skill catalog in the core prompt. */
  readonly includeSkillCatalog: boolean;
  /** When true, include the sub-agent catalog in the core prompt. */
  readonly includeSubAgentCatalog: boolean;
  /** When true, list enabled user-defined commands; otherwise show a placeholder. */
  readonly runCommandAvailable: boolean;
  /** Declared or full allowed tool set for this conversation (UDC / narrow mode); used for task instruction lines, not only active tools. */
  readonly availableTools: ToolName[];
  /** Optional sections merged into the core prompt for this turn. */
  readonly extraCorePromptSections?: ExtraCorePromptSection[];
}

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

  get commandProcessor(): IntentProcessor {
    return this.plugin.commandProcessorService.commandProcessor;
  }

  /**
   * Render a loading indicator for the agent
   * @param title The conversation title
   * @param lang The language code
   * @param toolName The tool name being executed
   */
  public renderIndicator?(title: string, lang?: string | null, toolName?: ToolName): Promise<void>;

  /**
   * Handle an agent invocation
   */
  public abstract handle(params: AgentHandlerParams, ...args: unknown[]): Promise<AgentResult>;

  /**
   * Tool names valid for resolving declared `intent.tools` (frontmatter / UDC).
   */
  public abstract getValidToolNames(): ReadonlySet<ToolName>;

  /**
   * Build the core system prompt for this agent.
   * Stream executors can pass rich context while text executors can omit it.
   */
  public abstract buildCorePrompt(context?: AgentCorePromptContext): string;

  /**
   * When false, GenerateTextExecutor omits skill/sub-agent/UDC catalog sections.
   * Delegated sub-agents receive task-specific instructions via intent.systemPrompts.
   */
  public includesDelegatedCatalogSections(): boolean {
    return true;
  }

  /**
   * Handle an agent invocation with automatic error handling and model fallback
   */
  public async safeHandle(params: AgentHandlerParams, ...args: unknown[]): Promise<AgentResult> {
    try {
      params.intent.model = await this.getCurrentModel(params.title, params.intent);
      params.intent.query = this.plugin.userMessageService.sanitizeQuery(params.intent.query);
      params.invocationCount =
        params.upstreamOptions?.invocationCount ?? params.invocationCount ?? 0;
      params.handlerId =
        params.upstreamOptions?.handlerId ?? params.handlerId ?? uniqueID();
      params.lang = params.lang || (await this.loadConversationLang(params.title));
      params.intent.tools = await this.resolveIntentTools(params.title, params.intent.tools);
      await this.loadConversationContext(params);

      // Call the original handle method
      const result = await this.handle(params, ...args);

      if (result.status === IntentResultStatus.NEEDS_CONFIRMATION) {
        this.commandProcessor.setLastResult(params.title, result);
        await this.renderer.showConfirmationButtons(params.title, result.buttonLabels);
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        const t = getTranslation(params.lang);
        await this.renderer.updateConversationNote({
          path: params.title,
          newContent: `*${t('stop.stopped')}*`,
          lang: params.lang,
          includeHistory: false,
          handlerId: params.handlerId,
        });
        return { status: IntentResultStatus.STOP_PROCESSING };
      }

      const errorMessage = getCaughtErrorMessage(error);
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
    } finally {
      await this.plugin.conversationRenderer.removeIndicator(params.title);
    }
  }

  /**
   * Get current model from the intent or frontmatter.
   */
  private async getCurrentModel(title: string, intent: Intent) {
    if (intent.model) {
      return intent.model;
    }

    // Check if model fallback is enabled
    const fallbackEnabled = this.plugin.modelFallbackService.isEnabled();
    const modelPromise = this.renderer.getConversationProperty<string>(title, 'model');

    // First, try to get the current model from the fallback state if available
    let currentModel = await modelPromise;

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

    // Remove duplicates, expand companions, and return
    return ToolRegistry.expandWithCompanionTools(Array.from(new Set(allTools)));
  }

  private async loadConversationLang(
    title: string,
    paramsLang?: string | null
  ): Promise<string | null> {
    const savedLang = await this.renderer.getConversationProperty<string>(title, 'lang');
    return paramsLang || savedLang || null;
  }

  /**
   * Merge intent tools from the intent and conversation frontmatter (`allowed_tools`).
   */
  private async resolveIntentTools(
    title: string,
    intentTools?: ToolName[]
  ): Promise<ToolName[] | undefined> {
    if (intentTools && intentTools.length > 0) {
      return intentTools;
    }
    const fromFrontmatter = await this.renderer.getConversationProperty<ToolName[]>(
      title,
      'allowed_tools'
    );
    if (fromFrontmatter && fromFrontmatter.length > 0) {
      return fromFrontmatter;
    }
    return undefined;
  }

  /**
   * Enrich the intent with conversation context from multiple sources in priority order:
   * 1. UDC system prompts (via udc_command frontmatter)
   * 2. Conversation-type-specific context (e.g. widget system prompts via session_type)
   * Skips entirely when systemPrompts are already set (orchestrator path).
   */
  private async loadConversationContext(params: AgentHandlerParams): Promise<void> {
    if (params.intent.systemPrompts && params.intent.systemPrompts.length > 0) {
      return;
    }

    const udcPrompts = await this.loadUdcSystemPrompts(params);
    if (udcPrompts && udcPrompts.length > 0) {
      params.intent.systemPrompts = udcPrompts;
      return;
    }

    const sessionType = await this.renderer.getConversationProperty<string>(
      params.title,
      'session_type'
    );
    if (sessionType !== 'widget') {
      return;
    }

    const widgetProjectPath = await this.renderer.getConversationProperty<string>(
      params.title,
      'widget_project_path'
    );
    if (!widgetProjectPath) {
      return;
    }

    const session =
      await this.plugin.widgetService.stateService.readSession(widgetProjectPath);
    if (!session) {
      return;
    }

    const context = await this.plugin.widgetService.sessionService.resolveWidgetContext({
      projectPath: widgetProjectPath,
      actorId: session.actor,
    });
    if (!context) {
      return;
    }

    if (context.systemPrompts.length > 0) {
      params.intent.systemPrompts = context.systemPrompts;
    }
    if (context.extraCorePromptSections.length > 0) {
      params.intent.extraCorePromptSections = context.extraCorePromptSections;
    }
  }

  /** Resolve UDC v2 system prompts from the conversation's udc_command frontmatter. */
  private async loadUdcSystemPrompts(params: AgentHandlerParams): Promise<string[] | undefined> {
    const udcCommand = await this.renderer.getConversationProperty<string>(
      params.title,
      'udc_command'
    );
    if (!udcCommand) {
      return undefined;
    }

    const command = this.plugin.userDefinedCommandService.userDefinedCommands.get(udcCommand);
    if (!command || command.getVersion() !== 2) {
      return undefined;
    }

    const rootSystemPrompts = command.normalized.system_prompt;
    if (!rootSystemPrompts || rootSystemPrompts.length === 0) {
      return undefined;
    }

    return this.plugin.userDefinedCommandService.processSystemPromptsWikilinks(rootSystemPrompts);
  }
}
