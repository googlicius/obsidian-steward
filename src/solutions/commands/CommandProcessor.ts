import { ConversationIntentReceivedPayload } from '../../types/events';
import { CommandHandler } from './CommandHandler';
import { logger } from '../../utils/logger';
import type StewardPlugin from 'src/main';
import { SystemPromptModifier, SystemPromptModification } from './SystemPromptModifier';
import { getClassifier } from 'src/lib/modelfusion';
import { Agent } from './Agent';
import { AgentResult, Intent, IntentResultStatus } from './types';
import { ToolName } from './ToolRegistry';

const VALID_TOOL_NAMES = new Set<string>(Object.values(ToolName));

interface PendingIntent {
  intents: Intent[];
  currentIndex: number;
  payload: ConversationIntentReceivedPayload;
  lastResult?: AgentResult;
}

export interface ProcessIntentsOptions {
  skipIndicators?: boolean;
  skipGeneralCommandCheck?: boolean;
  skipConfirmationCheck?: boolean;
  /**
   * If true, the built-in handler will be used in case a user-defined command has the same name as a built-in command.
   */
  builtInCommandPrecedence?: boolean;

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
  private pendingIntents: Map<string, PendingIntent> = new Map();
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private userDefinedCommandHandler: CommandHandler | null = null;
  private agentHandlers: Map<string, Agent> = new Map();

  constructor(private readonly plugin: StewardPlugin) {}

  get userDefinedCommandService() {
    return this.plugin.userDefinedCommandService;
  }

  /**
   * Register a command handler for a specific command type
   */
  public registerHandler(commandType: string, handler: CommandHandler): void {
    this.commandHandlers.set(commandType, handler);
  }

  /**
   * Register a user-defined command handler for handling user-defined commands
   */
  public registerUserDefinedCommandHandler(handler: CommandHandler): void {
    this.userDefinedCommandHandler = handler;
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

    if (this.isGeneralCommand(intents) && !options.skipGeneralCommandCheck) {
      // Check if we're waiting for user input (not yes/no confirmation)
      if (this.isWaitingForUserInput(title)) {
        await this.handleUserInput(title, intents[0]);
        return;
      }

      // Process general commands in an isolated processor
      // This prevents accidentally resetting pending commands when a general command
      // might actually be a confirmation command.
      await this.processCommandInIsolation(payload, intents[0].type, {
        ...options,
        skipGeneralCommandCheck: true,
      });
      return;
    }

    // Check if this is a confirmation command
    if (this.isConfirmation(intents) && !options.skipConfirmationCheck) {
      await this.processCommandInIsolation(payload, intents[0].type, {
        ...options,
        skipConfirmationCheck: true,
      });
      return;
    }

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
    commandType: string,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const isolatedProcessor = new CommandProcessor(this.plugin);

    const contextAugmentationHandler = this.commandHandlers.get('context_augmentation');

    if (contextAugmentationHandler) {
      isolatedProcessor.registerHandler('context_augmentation', contextAugmentationHandler);
    }

    const handler = this.commandHandlers.get(commandType);
    if (handler) {
      isolatedProcessor.registerHandler(commandType, handler);
    } else {
      logger.warn(`No command handler found for command type: ${commandType}`);
      return;
    }

    // Disable tracking for isolated processors (confirmations, etc.)
    await isolatedProcessor.processIntents(payload, options);
  }

  public isProcessing(title: string): boolean {
    return this.pendingIntents.has(title);
  }

  private isWaitingForUserInput(title: string): boolean {
    const pendingIntent = this.pendingIntents.get(title);
    if (!pendingIntent || !pendingIntent.lastResult) return false;
    return pendingIntent.lastResult.status === IntentResultStatus.NEEDS_USER_INPUT;
  }

  private isConfirmation(intents: Intent[]): boolean {
    if (!intents || intents.length === 0) return false;

    return intents.some(cmd => cmd.type === 'confirm' || cmd.type === 'yes' || cmd.type === 'no');
  }

  private isGeneralCommand(intents: Intent[]): boolean {
    return intents.length === 1 && intents[0].type === ' ';
  }

  private isUserDefinedCommand(commandType: string, builtInCommandPrecedence: boolean): boolean {
    if (!this.userDefinedCommandService.userDefinedCommands.has(commandType)) {
      return false;
    }

    if (this.commandHandlers.has(commandType) && builtInCommandPrecedence) {
      return false;
    }

    return true;
  }

  /**
   * Continue processing commands from the current index
   */
  public async continueProcessing(
    title: string,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const { builtInCommandPrecedence = false } = options;

    const pendingIntent = this.pendingIntents.get(title);
    if (!pendingIntent) {
      logger.warn(`No pending commands for conversation: ${title}`);
      return;
    }

    const { intents, currentIndex, payload } = pendingIntent;

    // No tracking command execution if command is confirm or stop.
    const noTrackingCommand =
      intents.length === 1 && this.plugin.commandTrackingService.noTrackingCommand(intents[0].type);

    // Initialize model fallback state if needed
    await this.plugin.modelFallbackService.initializeState(title);

    // Get stored user-defined command properties once before processing commands
    const udcCommandName = await this.plugin.conversationRenderer.getConversationProperty<string>(
      title,
      'udc_command'
    );
    let udcIntentsMap: Map<string, Intent> | undefined;

    if (udcCommandName) {
      udcIntentsMap = new Map();

      // Use expandUserDefinedCommandIntents to get all intents from the UDC
      const expandedIntents = this.userDefinedCommandService.expandUserDefinedCommandIntents({
        type: udcCommandName,
        query: '',
      });
      // Create a map for quick lookup by command type
      for (const intent of expandedIntents) {
        udcIntentsMap.set(intent.type, intent);
      }
    }

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
      const prevIntent = i > 0 ? intents[i - 1] : undefined;
      const nextIntent = i < intents.length - 1 ? intents[i + 1] : undefined;
      const nextIndex = i + 1;

      // Override properties from stored user-defined command if present (except query)
      const matchingIntent = udcIntentsMap?.get(baseType);
      if (matchingIntent) {
        // Take all intent from the UDC.
        intent = {
          ...matchingIntent,
          query: intent.query,
        };
      }

      intents[i] = intent;

      // Process wikilinks in intent.systemPrompts (only for string-based prompts)
      if (intent.systemPrompts && intent.systemPrompts.length > 0) {
        intent.systemPrompts = await this.processSystemPromptsWikilinks(intent.systemPrompts);
      }

      // Find the appropriate handler
      let handler = this.commandHandlers.get(baseType) || this.agentHandlers.get(baseType);

      // If we have a user-defined command handler, use it regardless of the current handler
      if (
        this.userDefinedCommandHandler &&
        this.isUserDefinedCommand(baseType, builtInCommandPrecedence)
      ) {
        handler = this.userDefinedCommandHandler;
      }

      if (!handler) {
        logger.warn(`No handler for command type: ${intent.type}`, this.commandHandlers);
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
        prevIntent,
        nextIntent,
        lang: payload.lang,
        activeTools: activeToolsFromQuery.length > 0 ? activeToolsFromQuery : undefined,
        upstreamOptions: options.sendToDownstream,
      });
      const trackingPromise = this.plugin.commandTrackingService.getTracking(title);
      if (!noTrackingCommand && (await trackingPromise)) {
        await this.plugin.commandTrackingService.recordIntentExecution(title, intent.type);
      }

      // Command completed successfully
      this.pendingIntents.set(title, {
        ...pendingIntent,
        currentIndex: nextIndex,
        lastResult: result,
      });

      // Handle the result
      switch (result.status) {
        case IntentResultStatus.ERROR:
          logger.error(`Command failed: ${intent.type}`, result.error);
          // Stop processing on error
          this.pendingIntents.delete(title);
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
          return;
      }
    }

    // All commands processed successfully
    this.pendingIntents.delete(title);

    // Save classification if tracking is enabled and active
    if (!noTrackingCommand) {
      await this.saveClassification(title);
    }
  }

  /**
   * Save classification after all commands finish
   */
  private async saveClassification(title: string): Promise<void> {
    const tracking = await this.plugin.commandTrackingService.getTracking(title, true);
    if (!tracking) {
      return;
    }

    const embeddingSettings = this.plugin.llmService.getEmbeddingSettings();
    const classifier = getClassifier(embeddingSettings, tracking.isReloadRequest);

    // Create cluster name from ACTUAL executed commands
    const clusterName = tracking.executedCommands.join(':');

    // Save embedding without awaiting to avoid blocking
    classifier.saveEmbedding(tracking.originalQuery, clusterName).catch(err => {
      logger.error('Failed to save embedding:', err);
    });
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
   * Get the command handler for a specific command type
   */
  public getCommandHandler(commandType: string): CommandHandler | null {
    return this.commandHandlers.get(commandType) || this.userDefinedCommandHandler;
  }

  /**
   * Check if a command type has a built-in handler
   */
  public hasBuiltInHandler(commandType: string): boolean {
    return this.commandHandlers.has(commandType);
  }

  /**
   * Clear all pending intents for a conversation
   */
  public clearIntents(title: string): void {
    this.pendingIntents.delete(title);
  }

  /**
   * Handle user input for a pending intent that requested it
   */
  private async handleUserInput(title: string, intent: Intent): Promise<void> {
    const pendingIntent = this.pendingIntents.get(title);
    if (!pendingIntent || !pendingIntent.lastResult) {
      return;
    }

    const lastResult = pendingIntent.lastResult;
    if (lastResult.status !== IntentResultStatus.NEEDS_USER_INPUT) {
      return;
    }

    // Call the onUserInput callback with the user's query
    const result = await lastResult.onUserInput(intent.query);

    // Update the pending command with the new result
    this.pendingIntents.set(title, {
      ...pendingIntent,
      lastResult: result,
    });

    // Handle the result
    if (result.status === IntentResultStatus.SUCCESS) {
      // Continue processing the command queue
      await this.continueProcessing(title);
    } else if (result.status === IntentResultStatus.ERROR) {
      logger.error(`User input handling failed: ${title}`, result.error);
      this.pendingIntents.delete(title);
    }
    // If the result is NEEDS_CONFIRMATION or NEEDS_USER_INPUT again,
    // the command will remain pending and wait for the next input
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
