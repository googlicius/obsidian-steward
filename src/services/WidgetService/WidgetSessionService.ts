import { TFile, normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import { uniqueID } from 'src/utils/uniqueID';
import { logger } from 'src/utils/logger';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { ToolName, ToolRegistry } from 'src/solutions/commands/ToolRegistry';
import { createAgentFromConfig } from 'src/solutions/commands/agents/AgentFactory';
import { DEFAULT_AGENT_CONFIGS } from 'src/solutions/commands/agents/defaultAgents';
import type { Agent } from 'src/solutions/commands/Agent';
import type { AgentHandlerParams, ExtraCorePromptSection } from 'src/solutions/commands/types';
import { DEFAULT_INTENT_TYPE } from 'src/solutions/commands/agents/intentHelpers';
import {
  DEFAULT_WIDGET_QUERY_NAME,
  resolveAgentAllowedQueries,
  widgetStateSaveOptionsSchema,
  type WidgetAgent,
  type WidgetDefinition,
  type WidgetSessionData,
  type WidgetStateSaveOptions,
} from './types';
import { WidgetDefinitionService } from './WidgetDefinitionService';
import { WidgetStateService } from './WidgetStateService';

const { getTranslation } = getBundledInternal('i18n');

export const WIDGET_PLAYGROUND_FILE = 'Playground.md';

export interface WidgetActorTurnResult {
  ok: boolean;
  error?: string;
}

/**
 * Session conversations, Playground embed, and model turn dispatch for interactive widgets.
 */
export class WidgetSessionService {
  private static instance: WidgetSessionService | null = null;

  private constructor(private readonly plugin: StewardPlugin) {}

  public static getInstance(plugin: StewardPlugin): WidgetSessionService {
    if (!WidgetSessionService.instance) {
      WidgetSessionService.instance = new WidgetSessionService(plugin);
    }
    return WidgetSessionService.instance;
  }

  /** Parses host-only `setState` options from the iframe bridge payload. */
  public static parseWidgetStateSaveOptions(options: unknown): WidgetStateSaveOptions | undefined {
    if (!options || typeof options !== 'object') {
      return undefined;
    }

    const result = widgetStateSaveOptionsSchema.safeParse(options);
    if (!result.success) {
      return undefined;
    }

    const parsed = result.data;
    if (!parsed.intent && !parsed.move && !parsed.source) {
      return undefined;
    }

    return parsed;
  }

  public appendMoveToSession(params: {
    session: WidgetSessionData;
    actorId: string;
    action: string;
    moveParams?: Record<string, unknown>;
    comment?: string;
  }): WidgetSessionData {
    const moveLog = [...(params.session.moveLog ?? [])];
    moveLog.push(
      this.createMoveLogEntry({
        actorId: params.actorId,
        action: params.action,
        moveParams: params.moveParams,
        comment: params.comment,
      })
    );

    return {
      ...params.session,
      moveLog,
    };
  }

  public advanceSessionTurn(params: {
    session: WidgetSessionData;
    turnOrder: string[];
  }): WidgetSessionData {
    if (params.turnOrder.length === 0) {
      return params.session;
    }

    const nextIndex = (params.session.turnIndex + 1) % params.turnOrder.length;
    return {
      ...params.session,
      turnIndex: nextIndex,
      actor: params.turnOrder[nextIndex],
    };
  }

  public appendMoveAndMaybeAdvanceSession(params: {
    session: WidgetSessionData;
    actorId: string;
    action: string;
    moveParams?: Record<string, unknown>;
    comment?: string;
    turnOrder: string[];
    endTurn: boolean;
  }): WidgetSessionData {
    const withMove = this.appendMoveToSession({
      session: params.session,
      actorId: params.actorId,
      action: params.action,
      moveParams: params.moveParams,
      comment: params.comment,
    });

    if (!params.endTurn || params.turnOrder.length === 0) {
      return withMove;
    }

    return this.advanceSessionTurn({
      session: withMove,
      turnOrder: params.turnOrder,
    });
  }

  public appendMoveAndAdvanceSession(params: {
    session: WidgetSessionData;
    actorId: string;
    action: string;
    moveParams?: Record<string, unknown>;
    comment?: string;
    turnOrder: string[];
  }): WidgetSessionData {
    return this.appendMoveAndMaybeAdvanceSession({
      ...params,
      endTurn: true,
    });
  }

  public createMoveLogEntry(params: {
    actorId: string;
    action: string;
    moveParams?: Record<string, unknown>;
    comment?: string;
    at?: string;
  }): NonNullable<WidgetSessionData['moveLog']>[number] {
    return {
      actor: params.actorId,
      action: WidgetSessionService.formatMoveLogAction(params.action, params.moveParams),
      ...(params.comment ? { comment: params.comment } : {}),
      at: params.at ?? new Date().toISOString(),
    };
  }

  private static formatMoveLogAction(action: string, params?: Record<string, unknown>): string {
    if (!params || Object.keys(params).length === 0) {
      return action;
    }

    const keys = Object.keys(params).sort();
    const parts: string[] = [];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      parts.push(`${key}=${JSON.stringify(params[key])}`);
    }

    return `${action}(${parts.join(', ')})`;
  }

  private get definitionService(): WidgetDefinitionService {
    return this.plugin.widgetService.definitionService;
  }

  private get stateService(): WidgetStateService {
    return this.plugin.widgetService.stateService;
  }

  public getPlaygroundPath(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/${WIDGET_PLAYGROUND_FILE}`);
  }

  private getConversationsFolder(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/Conversations`);
  }

  private buildSessionConversationTitle(widgetId: string): string {
    return `${widgetId}__session_${uniqueID()}`;
  }

  private buildConversationEmbedPath(conversationTitle: string): string {
    return `${this.getConversationsFolder()}/${conversationTitle}`;
  }

  /** Creates a persisted session when the orchestrator is about to run a model turn. */
  public async createSessionForModelTurn(params: {
    projectPath: string;
    widgetId: string;
    actorId: string;
    turnIndex: number;
    lang?: string | null;
    moveLog?: WidgetSessionData['moveLog'];
    lastDataSnapshot?: unknown;
    precedingHumanMove?: boolean;
  }): Promise<WidgetSessionData | null> {
    const gate = await this.readInteractiveGate(params.projectPath);
    if (!gate.ok || !gate.actors) {
      return null;
    }

    const existing = await this.stateService.readSession(params.projectPath);
    if (existing) {
      return existing;
    }

    const conversationTitle = this.buildSessionConversationTitle(params.widgetId);
    const definition = await this.definitionService.getWidgetDefinition(params.projectPath);
    const agent = definition.agents[params.actorId];
    await this.createSessionConversation({
      conversationTitle,
      projectPath: params.projectPath,
      widgetId: params.widgetId,
      actorId: params.actorId,
      lang: params.lang,
      tools: this.resolveActorTools(agent),
    });

    if (params.precedingHumanMove) {
      await this.appendHumanMoveMessage({
        conversationTitle,
        lang: params.lang,
      });
    }

    const session: WidgetSessionData = {
      conversationTitle,
      actor: params.actorId,
      turnIndex: params.turnIndex,
      phase: 'awaiting_input',
      moveLog: params.moveLog ?? [],
      ...(params.lastDataSnapshot !== undefined
        ? { lastDataSnapshot: params.lastDataSnapshot }
        : {}),
    };

    await this.stateService.writeSession({
      projectPath: params.projectPath,
      session,
    });

    await this.ensurePlaygroundNote({
      conversationTitle,
    });

    return session;
  }

  /** Clears host session state (e.g. iframe startNewSession bridge). Does not run a model turn. */
  public async startNewSession(params: {
    projectPath: string;
    widgetId: string;
    lang?: string | null;
  }): Promise<WidgetSessionData | null> {
    const gate = await this.readInteractiveGate(params.projectPath);
    if (!gate.ok) {
      return null;
    }

    await this.stateService.clearSession(params.projectPath);
    return null;
  }

  private async createSessionConversation(params: {
    conversationTitle: string;
    projectPath: string;
    widgetId: string;
    actorId: string;
    lang?: string | null;
    tools: ToolName[];
  }): Promise<void> {
    const conversationLanguage = params.lang ?? 'en';
    const indicatorText = this.plugin.conversationRenderer.getIndicatorTextByIntentType(
      DEFAULT_INTENT_TYPE,
      conversationLanguage
    );

    await this.plugin.conversationRenderer.createConversationNote(params.conversationTitle, {
      intent: {
        type: ' ',
        query: 'Widget session started.',
      },
      properties: [
        { name: 'lang', value: conversationLanguage },
        { name: 'indicator_text', value: indicatorText },
      ],
    });

    await this.plugin.conversationRenderer.updateConversationFrontmatter(params.conversationTitle, [
      { name: 'widget_project_path', value: params.projectPath },
      { name: 'widget_id', value: params.widgetId },
      { name: 'session_type', value: 'widget' },
      { name: 'tools', value: params.tools },
    ]);
  }

  public async ensurePlaygroundNote(
    params: { conversationTitle?: string | null } = {}
  ): Promise<string> {
    const playgroundPath = this.getPlaygroundPath();
    const content = this.buildPlaygroundContent(params.conversationTitle);

    await this.plugin.obsidianAPITools.ensureFolderExists(this.plugin.settings.stewardFolder);

    const existing = this.plugin.app.vault.getFileByPath(playgroundPath);
    if (existing) {
      await this.plugin.app.vault.modify(existing, content);
      return playgroundPath;
    }

    await this.plugin.app.vault.create(playgroundPath, content);
    return playgroundPath;
  }

  private buildPlaygroundContent(conversationTitle?: string | null): string {
    if (!conversationTitle) {
      return '';
    }

    const embedPath = this.buildConversationEmbedPath(conversationTitle);
    return `\n![[${embedPath}]]\n`;
  }

  public async appendHumanMoveMessage(params: {
    conversationTitle: string;
    lang?: string | null;
  }): Promise<void> {
    const lang =
      params.lang ??
      (await this.plugin.conversationRenderer.getConversationProperty<string>(
        params.conversationTitle,
        'lang'
      ));
    const t = getTranslation(lang);
    const message = t('widget.humanMove');

    await this.plugin.conversationRenderer.addUserMessage({
      path: params.conversationTitle,
      newContent: message,
      includeHistory: false,
      contentFormat: 'plain',
    });
  }

  public async runActorTurn(params: {
    projectPath: string;
    session: WidgetSessionData;
    actorId: string;
    agent: WidgetAgent;
    definition: WidgetDefinition;
    lang?: string | null;
  }): Promise<WidgetActorTurnResult> {
    const widgetActorConfig = DEFAULT_AGENT_CONFIGS.find(config => config.id === 'widget_actor');
    if (!widgetActorConfig) {
      return { ok: false, error: 'widget_actor_config_missing' };
    }

    const agentProduct = createAgentFromConfig(this.plugin, widgetActorConfig);
    if (!('safeHandle' in agentProduct) || typeof agentProduct.safeHandle !== 'function') {
      return { ok: false, error: 'widget_actor_not_runnable' };
    }

    const runnableAgent = agentProduct as Agent;
    const actorTools = this.resolveActorTools(params.agent);

    await this.plugin.conversationRenderer.updateConversationFrontmatter(
      params.session.conversationTitle,
      [{ name: 'tools', value: actorTools }]
    );

    const turnQuery = this.buildTurnContext({
      actorId: params.actorId,
      moveLog: params.session.moveLog ?? [],
    });

    const actorContext = await this.buildActorContext({
      agent: params.agent,
      definition: params.definition,
      projectPath: params.projectPath,
    });

    const handlerParams: AgentHandlerParams = {
      title: params.session.conversationTitle,
      intent: {
        type: ' ',
        query: turnQuery,
        tools: actorTools,
        systemPrompts: actorContext.systemPrompts,
        extraCorePromptSections: actorContext.extraCorePromptSections,
        model: params.agent.model,
        no_confirm: true,
      },
      lang: params.lang,
      handlerId: uniqueID(),
      invocationCount: 0,
      activeTools: actorTools,
    };

    try {
      await runnableAgent.safeHandle(handlerParams);
    } catch (error) {
      logger.error('Widget actor turn failed:', error);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return { ok: true };
  }

  /**
   * Records a successful move and optionally advances the turn roster.
   * Called by the widget_action handler after a model move is applied.
   * Keeps `phase: 'thinking'` when endTurn is false so the same actor may act again.
   */
  public async recordMoveAndMaybeAdvance(params: {
    projectPath: string;
    actorId: string;
    action: string;
    params?: Record<string, unknown>;
    comment?: string;
    turnOrder: string[];
    endTurn: boolean;
  }): Promise<void> {
    if (params.turnOrder.length === 0) {
      return;
    }

    const session = await this.stateService.readSession(params.projectPath);
    if (!session) {
      return;
    }

    const nextSession = this.appendMoveAndMaybeAdvanceSession({
      session,
      actorId: params.actorId,
      action: params.action,
      moveParams: params.params,
      comment: params.comment,
      turnOrder: params.turnOrder,
      endTurn: params.endTurn,
    });

    await this.stateService.writeSession({
      projectPath: params.projectPath,
      session: nextSession,
    });
  }

  /**
   * Shared entry point for resolving widget context (system prompts + extra core prompt sections)
   * from a project path and actor id. Used by both the orchestrator and AgentRunner paths.
   */
  public async resolveWidgetContext(params: { projectPath: string; actorId: string }): Promise<{
    systemPrompts: string[];
    extraCorePromptSections: ExtraCorePromptSection[];
  } | null> {
    const definition = await this.definitionService.getWidgetDefinition(params.projectPath);
    const agent = definition.agents[params.actorId];
    if (!agent) {
      return null;
    }

    return this.buildActorContext({
      agent,
      definition,
      projectPath: params.projectPath,
    });
  }

  /** Combines system prompt resolution and extra core prompt sections into one call. */
  private async buildActorContext(params: {
    agent: WidgetAgent;
    definition: WidgetDefinition;
    projectPath: string;
  }): Promise<{
    systemPrompts: string[];
    extraCorePromptSections: ExtraCorePromptSection[];
  }> {
    const definitionPath = normalizePath(`${params.projectPath}/Widget.md`);
    const rawPrompts = params.agent.instructions;

    const transformed: string[] = [];
    for (let i = 0; i < rawPrompts.length; i++) {
      transformed.push(
        this.plugin.noteContentService.transformHeadingOnlyWikilinks(rawPrompts[i], definitionPath)
      );
    }

    const systemPrompts: string[] = [];
    for (let i = 0; i < transformed.length; i++) {
      try {
        const processed = await this.plugin.userDefinedCommandService.processSystemPromptsWikilinks(
          [transformed[i]]
        );
        systemPrompts.push(processed[0]);
      } catch (error) {
        logger.warn('Widget actor system prompt wikilink resolution failed:', error);
        systemPrompts.push(transformed[i]);
      }
    }

    const allowedQueries = resolveAgentAllowedQueries(params.agent);
    const queryCatalog = params.definition.queries?.queries ?? {};
    const queryLines: string[] = [];
    for (let i = 0; i < allowedQueries.length; i++) {
      const queryName = allowedQueries[i];
      const description = this.describeAllowedQuery(queryName, queryCatalog);
      queryLines.push(`- \`${queryName}\`${description ? ` — ${description}` : ''}`);
    }

    const actionLines: string[] = [];
    const catalog = params.definition.actions?.actions ?? {};
    for (let i = 0; i < params.agent.actions.length; i++) {
      const actionName = params.agent.actions[i];
      const actionDef = catalog[actionName];
      const description = actionDef?.description ? ` — ${actionDef.description}` : '';
      const endTurnHint =
        actionDef?.endTurn === false ? ' — does not end your turn' : ' — ends your turn';
      actionLines.push(`- \`${actionName}\`${description}${endTurnHint}`);
    }

    return {
      systemPrompts,
      extraCorePromptSections: [
        { heading: '## Available queries', body: queryLines.join('\n') },
        { heading: '## Allowed actions', body: actionLines.join('\n') },
      ],
    };
  }

  private buildTurnContext(params: {
    actorId: string;
    moveLog: WidgetSessionData['moveLog'];
  }): string {
    const lines: string[] = [];

    lines.push(`You are actor \`${params.actorId}\`.`);

    const recentMoves = params.moveLog ?? [];
    if (recentMoves.length > 0) {
      lines.push('## Recent moves');
      const tail = recentMoves.slice(Math.max(0, recentMoves.length - 6));
      for (let i = 0; i < tail.length; i++) {
        const move = tail[i];
        const comment = move.comment ? ` (${move.comment})` : '';
        lines.push(`- ${move.actor}: ${move.action}${comment}`);
      }
    }

    lines.push(
      '',
      `Use widget_query to gather the data you need (defaults to \`${DEFAULT_WIDGET_QUERY_NAME}\`).`,
      'Take auxiliary actions as needed, then finish with an action that ends your turn.',
      'Actions marked "ends your turn" advance the roster; "does not end your turn" let you act again.'
    );
    return lines.join('\n');
  }

  private describeAllowedQuery(
    queryName: string,
    catalog: NonNullable<WidgetDefinition['queries']>['queries']
  ): string | undefined {
    if (queryName === DEFAULT_WIDGET_QUERY_NAME) {
      return catalog[queryName]?.description ?? 'Current public game state (JSON).';
    }
    return catalog[queryName]?.description;
  }

  private resolveActorTools(agent: WidgetAgent | undefined): ToolName[] {
    const sharedTools = agent?.tools ?? [];
    const result: ToolName[] = [ToolName.WIDGET_ACTION, ToolName.WIDGET_QUERY];
    const seen = new Set<ToolName>([ToolName.WIDGET_ACTION, ToolName.WIDGET_QUERY]);

    for (let i = 0; i < sharedTools.length; i++) {
      const tool = sharedTools[i];
      if (seen.has(tool)) {
        continue;
      }
      seen.add(tool);
      result.push(tool);
    }

    return ToolRegistry.expandWithCompanionTools(result);
  }

  private async readInteractiveGate(
    projectPath: string
  ): Promise<{ ok: boolean; actors: WidgetDefinition['actors'] }> {
    const definition = await this.definitionService.getWidgetDefinition(projectPath);
    if (Object.keys(definition.agents).length === 0 || !definition.actors) {
      return { ok: false, actors: null };
    }

    const definitionPath = normalizePath(`${projectPath}/Widget.md`);
    const file = this.plugin.app.vault.getFileByPath(definitionPath);
    if (!(file instanceof TFile)) {
      return { ok: false, actors: null };
    }

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const statusRaw = cache?.frontmatter?.status;
    const status = typeof statusRaw === 'string' ? statusRaw : undefined;
    const validStatus = this.definitionService.buildStatusMessage(true);
    if (status !== validStatus) {
      return { ok: false, actors: null };
    }

    if (cache?.frontmatter?.enabled === false) {
      return { ok: false, actors: null };
    }

    return { ok: true, actors: definition.actors };
  }
}
