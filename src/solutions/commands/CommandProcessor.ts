import { ConversationIntentReceivedPayload } from '../../types/events';
import { logger } from '../../utils/logger';
import type StewardPlugin from 'src/main';
import { SystemPromptModifier, SystemPromptModification } from './SystemPromptModifier';
import { Agent } from './Agent';
import { AgentResult, Intent, IntentResultStatus } from './types';
import { ToolName } from './ToolRegistry';

const VALID_TOOL_NAMES = new Set<string>(Object.values(ToolName));

interface PendingIntent {
  intents: Intent[];
  currentIndex: number;
  payload: ConversationIntentReceivedPayload;
}

export interface ProcessIntentsOptions {
  skipIndicators?: boolean;

  sendToDownstream?: {
    /**
     * If true, indicates this is a reload request
     */
    isReloadRequest?: boolean;
    /**
     * If true, skip the classification check
     */
    ignoreClassify?: boolean;
  };
}

export class CommandProcessor {
  /**
   * Store lastResult at conversation title level so it's accessible across processor instances
   */
  private static lastResults: Map<string, AgentResult> = new Map();
  private pendingIntents: Map<string, PendingIntent> = new Map();
  private agentHandlers: Map<string, Agent> = new Map();

  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Get the last result for a conversation (stored at conversation title level)
   */
  public getLastResult(title: string): AgentResult | undefined {
    return CommandProcessor.lastResults.get(title);
  }

  /**
   * Set the last result for a conversation (stored at conversation title level)
   */
  public setLastResult(title: string, result: AgentResult): void {
    CommandProcessor.lastResults.set(title, result);
  }

  /**
   * Clear the last result for a conversation
   */
  public clearLastResult(title: string): void {
    CommandProcessor.lastResults.delete(title);
  }

  /**
   * Register an agent handler for a specific agent type
   */
  public registerAgent(agentType: string, agent: Agent): void {
    this.agentHandlers.set(agentType, agent);
  }

  /**
   * Get the agent handler for a specific agent type
   */
  public getAgent(agentType: string): Agent | null {
    return this.agentHandlers.get(agentType) || null;
  }

  /**
   * Check if an agent type has a handler
   */
  public hasAgent(agentType: string): boolean {
    return this.agentHandlers.has(agentType);
  }

  /**
   * Process a list of intents
   */
  public async processIntents(
    payload: ConversationIntentReceivedPayload,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const { title, intents } = payload;

    // Start new command processing
    this.pendingIntents.set(title, {
      intents,
      currentIndex: 0,
      payload,
    });

    await this.continueProcessing(title, options);
  }

  /**
   * Process a single command with an isolated CommandProcessor instance
   * This allows processing the command without interfering with pending commands in the main processor
   */
  public async processCommandInIsolation(
    payload: ConversationIntentReceivedPayload,
    intentType: string,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const isolatedProcessor = new CommandProcessor(this.plugin);

    const handler = this.agentHandlers.get(intentType);
    if (handler) {
      isolatedProcessor.registerAgent(intentType, handler);
    } else {
      logger.warn(`No command handler found for intent type: ${intentType}`);
      return;
    }

    // Disable tracking for isolated processors (confirmations, etc.)
    await isolatedProcessor.processIntents(payload, options);
  }

  public isProcessing(title: string): boolean {
    return this.pendingIntents.has(title);
  }

  /**
   * Continue processing commands from the current index
   */
  public async continueProcessing(
    title: string,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const pendingIntent = this.pendingIntents.get(title);
    if (!pendingIntent) {
      logger.warn(`No pending commands for conversation: ${title}`);
      return;
    }

    const { intents, currentIndex, payload } = pendingIntent;

    // Initialize model fallback state if needed
    await this.plugin.modelFallbackService.initializeState(title);

    // Process intents sequentially from current index
    for (let i = currentIndex; i < intents.length; i++) {
      let intent = intents[i];
      const { baseType, queryParams } = this.parseIntentType(intent.type);
      const activeToolsFromQuery = this.extractToolsFromQuery(queryParams);
      if (baseType !== intent.type || activeToolsFromQuery.length > 0) {
        intent = {
          ...intent,
          type: baseType,
        };
      }
      const nextIndex = i + 1;

      intents[i] = intent;

      // Process wikilinks in intent.systemPrompts (only for string-based prompts)
      if (intent.systemPrompts && intent.systemPrompts.length > 0) {
        intent.systemPrompts = await this.processSystemPromptsWikilinks(intent.systemPrompts);
      }

      // Find the appropriate handler
      // Check if this is a user-defined command first
      const isUDC = this.plugin.userDefinedCommandService.hasCommand(baseType);
      let handler = this.agentHandlers.get(baseType) || null;

      // If it's a UDC, try to get UDC agent
      if (isUDC) {
        handler = this.agentHandlers.get('udc') || null;
      }

      if (!handler) {
        logger.warn(`No handler for command type: ${intent.type}`);
        // Continue to the next command instead of stopping
        continue;
      }

      // Show indicator if not skipped and handler has renderIndicator method
      if (!options.skipIndicators && handler.renderIndicator) {
        await handler.renderIndicator(title, payload.lang);
      }

      const result = await handler.safeHandle({
        title,
        intent,
        lang: payload.lang,
        activeTools: activeToolsFromQuery.length > 0 ? activeToolsFromQuery : undefined,
        upstreamOptions: options.sendToDownstream,
      });

      // Store lastResult at conversation title level (accessible across processor instances)
      if (
        result.status === IntentResultStatus.NEEDS_CONFIRMATION ||
        result.status === IntentResultStatus.NEEDS_USER_INPUT
      ) {
        this.setLastResult(title, result);
      }

      // Command completed successfully
      this.pendingIntents.set(title, {
        ...pendingIntent,
        currentIndex: nextIndex,
      });

      // Handle the result
      switch (result.status) {
        case IntentResultStatus.ERROR:
          logger.error(`Command failed: ${intent.type}`, result.error);
          // Stop processing on error
          this.pendingIntents.delete(title);
          this.clearLastResult(title);
          return;

        case IntentResultStatus.NEEDS_CONFIRMATION:
        case IntentResultStatus.NEEDS_USER_INPUT:
          // Pause processing until user provides additional input
          return;

        case IntentResultStatus.LOW_CONFIDENCE:
          logger.log(`Low confidence in: ${intent.type}, attempting context augmentation`);

          await this.processIntents({
            title,
            intents: [
              {
                type: 'context_augmentation',
                query: '',
                retryRemaining: 0, // We disable the context augmentation for now.
              },
            ],
            lang: payload.lang,
          });

          // Stop the current command processing
          this.pendingIntents.delete(title);
          this.clearLastResult(title);
          return;
      }
    }

    // All commands processed successfully
    this.pendingIntents.delete(title);
  }

  private parseIntentType(intentType: string): {
    baseType: string;
    queryParams: URLSearchParams | null;
  } {
    const [baseType, queryString] = intentType.split('?', 2);
    if (!queryString) {
      return { baseType, queryParams: null };
    }

    return {
      baseType,
      queryParams: new URLSearchParams(queryString),
    };
  }

  private extractToolsFromQuery(queryParams: URLSearchParams | null): ToolName[] {
    if (!queryParams) {
      return [];
    }

    const tools: ToolName[] = [];
    const seen = new Set<ToolName>();

    const rawValues = queryParams.getAll('tools');
    if (rawValues.length === 0) {
      return tools;
    }

    const candidates = rawValues
      .flatMap(entry => entry.split(','))
      .map(value => value.trim())
      .filter(value => value.length > 0);

    for (const candidate of candidates) {
      if (!VALID_TOOL_NAMES.has(candidate)) {
        continue;
      }

      const toolName = candidate as ToolName;
      if (seen.has(toolName)) {
        continue;
      }

      seen.add(toolName);
      tools.push(toolName);
    }

    return tools;
  }

  /**
   * Delete the next pending command for a conversation
   */
  public deleteNextPendingIntent(title: string): void {
    const pendingIntent = this.pendingIntents.get(title);
    if (!pendingIntent) return;

    // Set index to skip the next command
    const nextIndex = pendingIntent.currentIndex + 1;
    this.pendingIntents.set(title, {
      ...pendingIntent,
      currentIndex: nextIndex,
    });
  }

  /**
   * Get pending intent for a conversation
   */
  public getPendingIntent(title: string): PendingIntent | undefined {
    return this.pendingIntents.get(title);
  }

  /**
   * Set the current index for a pending intent
   */
  public setCurrentIndex(title: string, index: number): void {
    const pendingIntent = this.pendingIntents.get(title);
    if (pendingIntent) {
      this.pendingIntents.set(title, {
        ...pendingIntent,
        currentIndex: index,
      });
    }
  }

  /**
   * Check if a command type has a built-in handler
   */
  public hasBuiltInHandler(commandType: string): boolean {
    return this.agentHandlers.has(commandType);
  }

  /**
   * Clear all pending intents for a conversation
   */
  public clearIntents(title: string): void {
    this.pendingIntents.delete(title);
  }

  /**
   * Process wikilinks in system prompts
   * Only processes string-based prompts, keeps modification objects unchanged
   * @param systemPrompts Array of system prompt items (strings or modification objects)
   * @returns Processed system prompts with wikilinks resolved
   */
  private async processSystemPromptsWikilinks(
    systemPrompts: (string | SystemPromptModification)[]
  ): Promise<(string | SystemPromptModification)[]> {
    const modifier = new SystemPromptModifier(systemPrompts);
    const stringPrompts = modifier.getAdditionalSystemPrompts();

    // Process wikilinks only in string-based system prompts
    if (stringPrompts.length === 0) {
      return systemPrompts;
    }

    const processedStrings = await Promise.all(
      stringPrompts.map(prompt =>
        this.plugin.noteContentService.processWikilinksInContent(prompt, 2)
      )
    );

    // Reconstruct systemPrompts: replace strings with processed versions, keep modification objects
    return systemPrompts.map(item => {
      if (typeof item === 'string') {
        // Find the corresponding processed string
        const index = stringPrompts.indexOf(item);
        return processedStrings[index];
      }
      // Keep modification objects unchanged
      return item;
    });
  }
}
