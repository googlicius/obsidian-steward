import { TFile, normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import { uniqueID } from 'src/utils/uniqueID';
import { logger } from 'src/utils/logger';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { ToolName, ToolRegistry } from 'src/solutions/commands/ToolRegistry';
import { createAgentFromConfig } from 'src/solutions/commands/agents/AgentFactory';
import { DEFAULT_AGENT_CONFIGS } from 'src/solutions/commands/agents/defaultAgents';
import type { Agent } from 'src/solutions/commands/Agent';
import type { AgentHandlerParams } from 'src/solutions/commands/types';
import { DEFAULT_INTENT_TYPE } from 'src/solutions/commands/agents/intentHelpers';
import type {
  WidgetAgent,
  WidgetDefinition,
  WidgetSessionData,
  WidgetTurnContextPrefs,
} from './types';
import { WidgetDefinitionService } from './WidgetDefinitionService';
import { WidgetStateService } from './WidgetStateService';

const { getTranslation } = getBundledInternal('i18n');

export const WIDGET_PLAYGROUND_FILE = 'Playground.md';

/** Trailing conversation messages replayed on each widget actor turn. */
export const WIDGET_TURN_HISTORY_LIMIT = 4;

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
        type: 'widget_session',
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
      { name: 'widget_actor_id', value: params.actorId },
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

  public async appendMoveComment(params: {
    conversationTitle: string;
    actorId: string;
    action: string;
    comment?: string;
    lang?: string | null;
  }): Promise<void> {
    const lang =
      params.lang ??
      (await this.plugin.conversationRenderer.getConversationProperty<string>(
        params.conversationTitle,
        'lang'
      ));
    const t = getTranslation(lang);
    const commentSuffix = params.comment ? ` — ${params.comment}` : '';
    const message = t('widget.sessionMove', {
      actor: params.actorId,
      action: params.action,
      comment: commentSuffix,
    });

    await this.plugin.conversationRenderer.updateConversationNote({
      path: params.conversationTitle,
      newContent: message,
      role: 'Steward',
      includeHistory: false,
    });
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
    publicState: unknown;
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
      [
        { name: 'widget_actor_id', value: params.actorId },
        { name: 'tools', value: actorTools },
      ]
    );

    const systemPrompts = await this.resolveActorSystemPrompts({
      agent: params.agent,
      projectPath: params.projectPath,
    });

    const turnQuery = await this.buildTurnContext({
      projectPath: params.projectPath,
      publicState: params.publicState,
      agent: params.agent,
      definition: params.definition,
      moveLog: params.session.moveLog ?? [],
      turnContextPrefs: params.session.turnContextPrefs,
    });

    const handlerParams: AgentHandlerParams = {
      title: params.session.conversationTitle,
      intent: {
        type: ' ',
        query: turnQuery,
        tools: actorTools,
        systemPrompts,
        model: params.agent.model,
        no_confirm: true,
        maxHistoryMessages: WIDGET_TURN_HISTORY_LIMIT,
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
   * Records a successful model move and advances the turn roster.
   * Called by the widget_action handler the moment a move is applied, so the
   * session `actor` becomes the gate: any further widget_action in the same
   * agent loop sees a different `actor` and is rejected as out-of-turn.
   * Keeps `phase: 'thinking'` so the orchestrator owns the awaiting_input flip
   * after the agent loop ends (and onStateSaved keeps ignoring the move's save).
   */
  public async recordModelMoveAndAdvance(params: {
    projectPath: string;
    actorId: string;
    action: string;
    comment?: string;
    turnOrder: string[];
  }): Promise<void> {
    if (params.turnOrder.length === 0) {
      return;
    }

    const session = await this.stateService.readSession(params.projectPath);
    if (!session) {
      return;
    }

    const moveLog = [...(session.moveLog ?? [])];
    moveLog.push({
      actor: params.actorId,
      action: params.action,
      ...(params.comment ? { comment: params.comment } : {}),
      at: new Date().toISOString(),
    });

    const nextIndex = (session.turnIndex + 1) % params.turnOrder.length;
    await this.stateService.writeSession({
      projectPath: params.projectPath,
      session: {
        ...session,
        moveLog,
        turnIndex: nextIndex,
        actor: params.turnOrder[nextIndex],
      },
    });
  }

  public async updateTurnContextPrefs(params: {
    projectPath: string;
    prefs: WidgetTurnContextPrefs;
  }): Promise<void> {
    const session = await this.stateService.readSession(params.projectPath);
    if (!session) {
      return;
    }

    await this.stateService.writeSession({
      projectPath: params.projectPath,
      session: {
        ...session,
        turnContextPrefs: params.prefs,
      },
    });
  }

  private async buildTurnContext(params: {
    projectPath: string;
    publicState: unknown;
    agent: WidgetAgent;
    definition: WidgetDefinition;
    moveLog: WidgetSessionData['moveLog'];
    turnContextPrefs?: WidgetSessionData['turnContextPrefs'];
  }): Promise<string> {
    const includeJson = params.turnContextPrefs?.includeJson !== false;
    const includePresentation = params.turnContextPrefs?.includePresentation !== false;
    let presentation: string | undefined;
    let presentationError: string | undefined;

    if (includePresentation) {
      const result = await this.plugin.widgetService.getStatePresentation({
        projectPath: params.projectPath,
      });
      if (result.ok && result.presentation) {
        presentation = result.presentation;
      } else {
        presentationError = result.error;
      }
    }

    const lines = this.buildTurnContextStateSection({
      publicState: params.publicState,
      prefs: { includeJson, includePresentation },
      presentation,
      presentationError,
    });

    lines.push(
      '',
      'On `widget_action`, set `with_json: false` or `with_presentation: false` to omit that section on your **next** turn (defaults: both true; at least one must stay enabled).'
    );

    lines.push('', '## Allowed actions');
    const catalog = params.definition.actions?.actions ?? {};
    for (let i = 0; i < params.agent.actions.length; i++) {
      const actionName = params.agent.actions[i];
      const actionDef = catalog[actionName];
      const description = actionDef?.description ? ` — ${actionDef.description}` : '';
      lines.push(`- \`${actionName}\`${description}`);
    }

    const recentMoves = params.moveLog ?? [];
    if (recentMoves.length > 0) {
      lines.push('', '## Recent moves');
      const tail = recentMoves.slice(Math.max(0, recentMoves.length - 6));
      for (let i = 0; i < tail.length; i++) {
        const move = tail[i];
        const comment = move.comment ? ` (${move.comment})` : '';
        lines.push(`- ${move.actor}: ${move.action}${comment}`);
      }
    }

    lines.push('', 'Take exactly one allowed action via widget_action.');
    return lines.join('\n');
  }

  private async resolveActorSystemPrompts(params: {
    agent: WidgetAgent;
    projectPath: string;
  }): Promise<string[]> {
    const definitionPath = normalizePath(`${params.projectPath}/Widget.md`);
    const rawPrompts = params.agent.instructions;

    const transformed: string[] = [];
    for (let i = 0; i < rawPrompts.length; i++) {
      transformed.push(
        this.plugin.noteContentService.transformHeadingOnlyWikilinks(rawPrompts[i], definitionPath)
      );
    }

    const resolved: string[] = [];
    for (let i = 0; i < transformed.length; i++) {
      try {
        const processed = await this.plugin.userDefinedCommandService.processSystemPromptsWikilinks(
          [transformed[i]]
        );
        resolved.push(processed[0]);
      } catch (error) {
        logger.warn('Widget actor system prompt wikilink resolution failed:', error);
        resolved.push(transformed[i]);
      }
    }

    return resolved;
  }

  private resolveActorTools(agent: WidgetAgent | undefined): ToolName[] {
    const sharedTools = agent?.tools ?? [];
    const result: ToolName[] = [ToolName.WIDGET_ACTION];
    const seen = new Set<ToolName>([ToolName.WIDGET_ACTION]);

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

  private formatPresentationUnavailableNote(error?: string): string {
    if (error === 'state_presentation_not_registered') {
      return '_Text view unavailable: widget has no `formatStateForModel` handler registered._';
    }

    if (error === 'state_presentation_invalid') {
      return '_Text view unavailable: `formatStateForModel` returned empty or non-text output._';
    }

    if (error === 'widget_not_mounted') {
      return '_Text view unavailable: widget is not mounted._';
    }

    if (error === 'state_presentation_timeout') {
      return '_Text view unavailable: presentation timed out._';
    }

    if (error) {
      return `_Text view unavailable: ${error}_`;
    }

    return '_Text view unavailable._';
  }

  private buildTurnContextStateSection(params: {
    publicState: unknown;
    prefs: WidgetTurnContextPrefs;
    presentation?: string;
    presentationError?: string;
  }): string[] {
    const lines: string[] = ['## Current game state'];

    if (params.prefs.includeJson) {
      lines.push('```json', JSON.stringify(params.publicState, null, 2), '```');
    }

    if (params.prefs.includePresentation) {
      if (params.presentation) {
        if (params.prefs.includeJson) {
          lines.push('');
        }
        lines.push('```text', params.presentation, '```');
      } else {
        lines.push('', this.formatPresentationUnavailableNote(params.presentationError));
      }
    }

    return lines;
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
