import { ConversationIntentReceivedPayload } from '../../../types/events';
import { logger } from '../../../utils/logger';
import type StewardPlugin from 'src/main';
import type { ProcessIntentsOptions } from '../IntentProcessor';
import { Agent } from '../Agent';
import { AgentResult, Intent, IntentResultStatus } from '../types';
import type { AgentConfig } from './AgentConfig';
import { createAgentFromConfig } from './AgentFactory';
import { DEFAULT_INTENT_TYPE, extractToolsFromQuery, parseIntentType } from './intentHelpers';
import { ToolName } from '../ToolRegistry';

interface PendingIntent {
  intents: Intent[];
  currentIndex: number;
  payload: ConversationIntentReceivedPayload;
}

export type { ProcessIntentsOptions } from '../IntentProcessor';

/** Config IDs that handle intents (excludes title, compaction_summary). */
const INTENT_ROUTING_IDS = new Set(['super', 'subagent', 'udc', 'search', 'speech', 'image']);

export class AgentRunner {
  private static lastResults: Map<string, AgentResult> = new Map();
  private pendingIntents: Map<string, PendingIntent> = new Map();
  private agentCache: Map<string, Agent> = new Map();

  constructor(
    private readonly plugin: StewardPlugin,
    private readonly agentConfigs: AgentConfig[]
  ) {}

  /**
   * Resolve intent baseType to agent config id.
   * Maps ' ' to 'super', UDC commands to 'udc', else returns baseType.
   */
  private resolveAgentId(baseType: string): string {
    if (baseType === DEFAULT_INTENT_TYPE || baseType === '') {
      return 'super';
    }
    if (this.plugin.userDefinedCommandService.hasCommand(baseType)) {
      return 'udc';
    }
    return baseType;
  }

  /**
   * Get or create an Agent for the given config id.
   * Only returns agents that extend Agent (super, udc) and support safeHandle.
   */
  private getOrCreateAgent(agentId: string): Agent | null {
    const cached = this.agentCache.get(agentId);
    if (cached) {
      return cached;
    }
    const config = this.agentConfigs.find(c => c.id === agentId);
    if (!config || !INTENT_ROUTING_IDS.has(config.id)) {
      return null;
    }
    const product = createAgentFromConfig(this.plugin, config);
    if (!('safeHandle' in product) || typeof product.safeHandle !== 'function') {
      return null;
    }
    const agent = product as Agent;
    this.agentCache.set(agentId, agent);
    return agent;
  }

  private getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.find(config => config.id === agentId);
  }

  public getLastResult(title: string): AgentResult | undefined {
    return AgentRunner.lastResults.get(title);
  }

  public setLastResult(title: string, result: AgentResult): void {
    AgentRunner.lastResults.set(title, result);
  }

  public clearLastResult(title: string): void {
    AgentRunner.lastResults.delete(title);
  }

  public async processIntents(
    payload: ConversationIntentReceivedPayload,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const { title, intents } = payload;

    this.pendingIntents.set(title, {
      intents: intents as Intent[],
      currentIndex: 0,
      payload,
    });

    await this.continueProcessing(title, options);
  }

  /**
   * Process a single command with an isolated AgentRunner instance.
   */
  public async processCommandInIsolation(
    payload: ConversationIntentReceivedPayload,
    intentType: string,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    const { baseType } = parseIntentType(intentType);
    const agentId = this.resolveAgentId(baseType);
    const config = this.agentConfigs.find(c => c.id === agentId);
    if (!config || !INTENT_ROUTING_IDS.has(config.id)) {
      logger.warn(`No command handler found for intent type: ${intentType}`);
      return;
    }
    const isolatedRunner = new AgentRunner(this.plugin, [config]);
    await isolatedRunner.processIntents(payload, options);
  }

  public isProcessing(title: string): boolean {
    return this.pendingIntents.has(title);
  }

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

    await this.plugin.modelFallbackService.initializeState(title);

    for (let i = currentIndex; i < intents.length; i++) {
      let intent = intents[i];
      const { baseType, queryParams } = parseIntentType(intent.type);
      const activeToolsFromQuery = extractToolsFromQuery(queryParams);
      if (baseType !== intent.type || activeToolsFromQuery.length > 0) {
        intent = { ...intent, type: baseType };
      }
      const nextIndex = i + 1;
      intents[i] = intent;

      if (intent.systemPrompts && intent.systemPrompts.length > 0) {
        intent.systemPrompts = await this.processSystemPromptsWikilinks(intent.systemPrompts);
      }

      const agentId = this.resolveAgentId(baseType);
      const config = this.getAgentConfig(agentId);
      const agent = this.getOrCreateAgent(agentId);

      if (!agent) {
        logger.warn(`No agent for command type: ${intent.type}`);
        this.pendingIntents.set(title, { ...pendingIntent, currentIndex: nextIndex });
        continue;
      }

      const canUseTools = config?.canUseTools !== false;
      if (!canUseTools) {
        intent = {
          ...intent,
          tools: [ToolName.SWITCH_AGENT_CAPACITY],
        };
        intents[i] = intent;
      }

      setTimeout(() => {
        if (agent.renderIndicator) {
          agent.renderIndicator(title, payload.lang);
        }
      }, 50);

      const result = await agent.safeHandle({
        title,
        intent,
        lang: payload.lang,
        activeTools:
          canUseTools && activeToolsFromQuery.length > 0 ? activeToolsFromQuery : undefined,
        upstreamOptions: options.sendToDownstream,
      });

      if (
        result.status === IntentResultStatus.NEEDS_CONFIRMATION ||
        result.status === IntentResultStatus.NEEDS_USER_INPUT
      ) {
        this.setLastResult(title, result);
      }

      this.pendingIntents.set(title, { ...pendingIntent, currentIndex: nextIndex });

      switch (result.status) {
        case IntentResultStatus.ERROR:
          logger.error(`Command failed: ${intent.type}`, result.error);
          this.pendingIntents.delete(title);
          this.clearLastResult(title);
          return;

        case IntentResultStatus.NEEDS_CONFIRMATION:
        case IntentResultStatus.NEEDS_USER_INPUT:
          return;

        case IntentResultStatus.LOW_CONFIDENCE:
          logger.log(`Low confidence in: ${intent.type}, attempting context augmentation`);
          await this.processIntents({
            title,
            intents: [{ type: 'context_augmentation', query: '', retryRemaining: 0 }],
            lang: payload.lang,
          });
          this.pendingIntents.delete(title);
          this.clearLastResult(title);
          return;
      }
    }

    this.pendingIntents.delete(title);
  }

  public deleteNextPendingIntent(title: string): void {
    const pendingIntent = this.pendingIntents.get(title);
    if (!pendingIntent) return;
    this.pendingIntents.set(title, {
      ...pendingIntent,
      currentIndex: pendingIntent.currentIndex + 1,
    });
  }

  public getPendingIntent(title: string): PendingIntent | undefined {
    return this.pendingIntents.get(title);
  }

  public setCurrentIndex(title: string, index: number): void {
    const pendingIntent = this.pendingIntents.get(title);
    if (pendingIntent) {
      this.pendingIntents.set(title, { ...pendingIntent, currentIndex: index });
    }
  }

  public hasBuiltInHandler(commandType: string): boolean {
    const agentId = this.resolveAgentId(commandType.split('?')[0]);
    const config = this.agentConfigs.find(c => c.id === agentId);
    return !!config && INTENT_ROUTING_IDS.has(config.id);
  }

  public clearIntents(title: string): void {
    this.pendingIntents.delete(title);
  }

  private async processSystemPromptsWikilinks(systemPrompts: string[]): Promise<string[]> {
    if (systemPrompts.length === 0) return systemPrompts;
    return Promise.all(
      systemPrompts.map(prompt =>
        this.plugin.noteContentService.processWikilinksInContent(prompt, 2)
      )
    );
  }
}
