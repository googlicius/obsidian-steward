import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import type {
  WidgetActors,
  WidgetActionResult,
  WidgetDefinition,
  WidgetSessionData,
  WidgetStateSaveMove,
  WidgetStateSaveOptions,
} from './types';
import { WidgetSessionService } from './WidgetSessionService';
import { WidgetStateService } from './WidgetStateService';
import { WidgetDefinitionService } from './WidgetDefinitionService';
import { WIDGET_STATE_SAVE_SOURCE_MODEL_DISPATCH } from './WidgetProtocol';

const MODELS_ONLY_BURST_CAP = 10;

type BootstrapSession = {
  actor: string;
  turnIndex: number;
  moveLog?: WidgetSessionData['moveLog'];
  lastDataSnapshot?: unknown;
  precedingHumanMove?: boolean;
};

/**
 * Turn scheduling for interactive widgets: human saves advance the roster; model actors run via widget_actor.
 * Session is persisted only when a model turn runs (user-initiated `start` / `reset_and_start`, or human gameplay saves).
 */
export class WidgetOrchestrator {
  private static instance: WidgetOrchestrator | null = null;
  private readonly locks = new Set<string>();

  private constructor(private readonly plugin: StewardPlugin) {}

  public static getInstance(plugin: StewardPlugin): WidgetOrchestrator {
    if (!WidgetOrchestrator.instance) {
      WidgetOrchestrator.instance = new WidgetOrchestrator(plugin);
    }
    return WidgetOrchestrator.instance;
  }

  private get sessionService(): WidgetSessionService {
    return this.plugin.widgetService.sessionService;
  }

  private get stateService(): WidgetStateService {
    return this.plugin.widgetService.stateService;
  }

  private get definitionService(): WidgetDefinitionService {
    return this.plugin.widgetService.definitionService;
  }

  public async handleStateSave(params: {
    projectPath: string;
    widgetId: string;
    incomingData: unknown;
    saveOptions?: WidgetStateSaveOptions;
    lang?: string | null;
  }): Promise<void> {
    const previous = await this.stateService.readState(params.projectPath);
    const previousData = previous?.data;

    await this.stateService.writeState({
      projectPath: params.projectPath,
      data: params.incomingData,
    });

    await this.withProjectLock(params.projectPath, async () => {
      await this.onStateSaved({
        ...params,
        previousData,
      });
    });
  }

  private async onStateSaved(params: {
    projectPath: string;
    widgetId: string;
    incomingData: unknown;
    previousData: unknown;
    saveOptions?: WidgetStateSaveOptions;
    lang?: string | null;
  }): Promise<void> {
    const definition = await this.definitionService.getWidgetDefinition(params.projectPath);
    if (Object.keys(definition.agents).length === 0 || !definition.actors) {
      return;
    }

    if (!(await this.isDefinitionEnabled(params.projectPath))) {
      return;
    }

    const isReset = this.isSessionResetRequest(params.saveOptions);
    const isUserStart = this.isUserStartRequest(params.saveOptions);

    if (isReset) {
      await this.stateService.clearSession(params.projectPath);
    }

    if (isUserStart) {
      await this.triggerUserInitiatedStart({
        projectPath: params.projectPath,
        widgetId: params.widgetId,
        definition,
        incomingData: params.incomingData,
        lang: params.lang,
      });
      return;
    }

    if (isReset) {
      return;
    }

    const session = await this.stateService.readSession(params.projectPath);
    if (!session) {
      await this.onGameplaySaveWithoutSession(params);
      return;
    }

    if (session.phase === 'thinking' || session.phase === 'ended') {
      return;
    }

    if (this.isSameSnapshot(session.lastDataSnapshot, params.incomingData)) {
      return;
    }

    const actorEntry = definition.actors.actors[session.actor];
    if (!actorEntry) {
      return;
    }

    let workingSession: WidgetSessionData = {
      ...session,
      lastDataSnapshot: params.incomingData,
    };

    if (actorEntry.kind === 'human' && session.suppressHumanAdvanceOnce) {
      await this.stateService.writeSession({
        projectPath: params.projectPath,
        session: {
          ...workingSession,
          suppressHumanAdvanceOnce: false,
        },
      });
      return;
    }

    if (
      actorEntry.kind === 'human' &&
      params.saveOptions?.source === WIDGET_STATE_SAVE_SOURCE_MODEL_DISPATCH
    ) {
      await this.stateService.writeSession({
        projectPath: params.projectPath,
        session: workingSession,
      });
      return;
    }

    if (actorEntry.kind === 'human') {
      if (!params.saveOptions?.move?.action) {
        await this.stateService.writeSession({
          projectPath: params.projectPath,
          session: workingSession,
        });
        return;
      }

      const humanMove = params.saveOptions.move;
      const endTurn = this.resolveActionEndTurn({
        definition,
        actionName: humanMove.action,
        saveMove: humanMove,
      });
      workingSession = this.sessionService.appendMoveAndMaybeAdvanceSession({
        session: workingSession,
        actorId: session.actor,
        action: humanMove.action,
        moveParams: humanMove.params,
        comment: humanMove.comment,
        turnOrder: definition.actors.turnOrder,
        endTurn,
      });
      await this.stateService.writeSession({
        projectPath: params.projectPath,
        session: workingSession,
      });

      if (workingSession.conversationTitle) {
        await this.sessionService.appendHumanMoveMessage({
          conversationTitle: workingSession.conversationTitle,
          lang: params.lang,
        });
      }

      const nextEntry = definition.actors.actors[workingSession.actor];
      if (!nextEntry || nextEntry.kind !== 'model') {
        return;
      }
    } else {
      workingSession = this.completeModelTurnFromExternalSave({
        session: workingSession,
        actingActorId: session.actor,
        turnOrder: definition.actors.turnOrder,
        saveOptions: params.saveOptions,
        definition,
      });
      await this.stateService.writeSession({
        projectPath: params.projectPath,
        session: workingSession,
      });
      return;
    }

    await this.runModelTurnChain({
      projectPath: params.projectPath,
      widgetId: params.widgetId,
      definition,
      actors: definition.actors,
      lang: params.lang,
      burstCount: 0,
    });
  }

  /**
   * Cold-start gameplay path when state is saved before any session file exists.
   * Treats the save as the first human turn: skip unchanged snapshots, advance the
   * turn roster in memory, and run the model chain when the next actor is a model
   * (session persistence happens inside that chain, not on mount).
   */
  private async onGameplaySaveWithoutSession(params: {
    projectPath: string;
    widgetId: string;
    incomingData: unknown;
    previousData: unknown;
    saveOptions?: WidgetStateSaveOptions;
    lang?: string | null;
  }): Promise<void> {
    const definition = await this.definitionService.getWidgetDefinition(params.projectPath);
    if (!definition.actors) {
      return;
    }

    const actors = definition.actors;
    const firstActorId = actors.turnOrder[0];
    const firstEntry = actors.actors[firstActorId];
    if (!firstEntry || firstEntry.kind !== 'human') {
      return;
    }

    if (this.isSameSnapshot(params.previousData, params.incomingData)) {
      return;
    }

    if (!params.saveOptions?.move?.action) {
      return;
    }

    const advanced = this.advanceTurn({
      session: {
        conversationTitle: '',
        actor: firstActorId,
        turnIndex: 0,
        phase: 'awaiting_input',
        lastDataSnapshot: params.incomingData,
      },
      turnOrder: actors.turnOrder,
    });

    const humanMove = params.saveOptions.move;
    const moveLog = [
      this.sessionService.createMoveLogEntry({
        actorId: firstActorId,
        action: humanMove.action,
        moveParams: humanMove.params,
        comment: humanMove.comment,
      }),
    ];

    const nextEntry = actors.actors[advanced.actor];
    if (!nextEntry || nextEntry.kind !== 'model') {
      return;
    }

    await this.runModelTurnChain({
      projectPath: params.projectPath,
      widgetId: params.widgetId,
      definition,
      actors,
      lang: params.lang,
      burstCount: 0,
      bootstrapSession: {
        actor: advanced.actor,
        turnIndex: advanced.turnIndex,
        moveLog,
        lastDataSnapshot: params.incomingData,
        precedingHumanMove: true,
      },
    });
  }

  private async runModelTurnChain(params: {
    projectPath: string;
    widgetId: string;
    definition: WidgetDefinition;
    actors: WidgetActors;
    lang?: string | null;
    burstCount: number;
    bootstrapSession?: BootstrapSession;
  }): Promise<void> {
    if (params.burstCount >= MODELS_ONLY_BURST_CAP) {
      return;
    }

    let session = await this.stateService.readSession(params.projectPath);
    if (!session) {
      const bootstrap = params.bootstrapSession;
      if (!bootstrap) {
        return;
      }

      session = await this.sessionService.createSessionForModelTurn({
        projectPath: params.projectPath,
        widgetId: params.widgetId,
        actorId: bootstrap.actor,
        turnIndex: bootstrap.turnIndex,
        lang: params.lang,
        moveLog: bootstrap.moveLog,
        lastDataSnapshot: bootstrap.lastDataSnapshot,
        precedingHumanMove: bootstrap.precedingHumanMove,
      });
      if (!session) {
        return;
      }
    }

    if (session.phase === 'thinking' || session.phase === 'ended') {
      return;
    }

    const actorEntry = params.actors.actors[session.actor];
    if (!actorEntry || actorEntry.kind !== 'model') {
      return;
    }

    const agent = params.definition.agents[session.actor];
    if (!agent) {
      return;
    }

    const actingActorId = session.actor;
    const turnIndexBeforeTurn = session.turnIndex;
    session = { ...session, phase: 'thinking' };
    await this.stateService.writeSession({
      projectPath: params.projectPath,
      session,
    });

    const state = await this.stateService.readState(params.projectPath);
    const turnResult = await this.sessionService.runActorTurn({
      projectPath: params.projectPath,
      session,
      actorId: actingActorId,
      agent,
      definition: params.definition,
      lang: params.lang,
    });

    const refreshedState = await this.stateService.readState(params.projectPath);
    const publicData = refreshedState?.data ?? state?.data ?? {};

    const currentSession = await this.stateService.readSession(params.projectPath);
    if (!currentSession) {
      return;
    }

    // The widget_action handler advances the roster when an endTurn action lands.
    // An unchanged turnIndex means no terminal move completed this model turn.
    const turnEnded = currentSession.turnIndex !== turnIndexBeforeTurn;
    if (!turnResult.ok || !turnEnded) {
      await this.stateService.writeSession({
        projectPath: params.projectPath,
        session: { ...currentSession, phase: 'awaiting_input' },
      });
      return;
    }

    const finalizedSession: WidgetSessionData = {
      ...currentSession,
      phase: 'awaiting_input',
      lastDataSnapshot: publicData,
    };
    await this.stateService.writeSession({
      projectPath: params.projectPath,
      session: finalizedSession,
    });

    if (params.actors.mode !== 'models_only') {
      return;
    }

    const nextEntry = params.actors.actors[finalizedSession.actor];
    if (!nextEntry || nextEntry.kind !== 'model') {
      return;
    }

    await this.runModelTurnChain({
      projectPath: params.projectPath,
      widgetId: params.widgetId,
      definition: params.definition,
      actors: params.actors,
      lang: params.lang,
      burstCount: params.burstCount + 1,
    });
  }

  /**
   * Reconciles session when board data changes while the roster still expects a model
   * actor (e.g. widget_action via a side conversation after a failed orchestrator turn).
   */
  private completeModelTurnFromExternalSave(params: {
    session: WidgetSessionData;
    actingActorId: string;
    turnOrder: string[];
    saveOptions?: WidgetStateSaveOptions;
    definition: WidgetDefinition;
  }): WidgetSessionData {
    const externalMove = params.saveOptions?.move?.action
      ? params.saveOptions.move
      : { action: 'unknown' };
    const endTurn = this.resolveActionEndTurn({
      definition: params.definition,
      actionName: externalMove.action,
      saveMove: externalMove,
    });

    return this.sessionService.appendMoveAndMaybeAdvanceSession({
      session: {
        ...params.session,
        phase: 'awaiting_input',
      },
      actorId: params.actingActorId,
      action: externalMove.action,
      moveParams: externalMove.params,
      comment: externalMove.comment,
      turnOrder: params.turnOrder,
      endTurn,
    });
  }

  /**
   * Moves the widget session to the next actor in the turn roster.
   */
  private advanceTurn(params: {
    session: WidgetSessionData;
    turnOrder: string[];
  }): WidgetSessionData {
    const nextIndex = (params.session.turnIndex + 1) % params.turnOrder.length;
    return {
      ...params.session,
      turnIndex: nextIndex,
      actor: params.turnOrder[nextIndex],
    };
  }

  private isSameSnapshot(previous: unknown, incoming: unknown): boolean {
    try {
      return JSON.stringify(previous) === JSON.stringify(incoming);
    } catch {
      return false;
    }
  }

  private isSessionResetRequest(saveOptions?: WidgetStateSaveOptions): boolean {
    const intent = saveOptions?.intent;
    return intent === 'reset' || intent === 'reset_and_start';
  }

  private isUserStartRequest(saveOptions?: WidgetStateSaveOptions): boolean {
    const intent = saveOptions?.intent;
    return intent === 'start' || intent === 'reset_and_start';
  }

  /**
   * User click/hotkey path: when turnOrder opens with a model actor (or mode is models_only),
   * bootstrap session and run the model chain. Never called on mount.
   */
  private async triggerUserInitiatedStart(params: {
    projectPath: string;
    widgetId: string;
    definition: WidgetDefinition;
    incomingData: unknown;
    lang?: string | null;
  }): Promise<void> {
    const actors = params.definition.actors;
    if (!actors) {
      return;
    }

    const session = await this.stateService.readSession(params.projectPath);
    if (session && this.isSessionBlockingUserStart(session)) {
      return;
    }

    if (session) {
      const actorEntry = actors.actors[session.actor];
      if (!actorEntry || actorEntry.kind !== 'model') {
        return;
      }

      await this.runModelTurnChain({
        projectPath: params.projectPath,
        widgetId: params.widgetId,
        definition: params.definition,
        actors,
        lang: params.lang,
        burstCount: 0,
      });
      return;
    }

    const firstActorId = actors.turnOrder[0];
    const firstEntry = actors.actors[firstActorId];
    if (!firstEntry) {
      return;
    }

    const shouldRunModel = actors.mode === 'models_only' || firstEntry.kind === 'model';
    if (!shouldRunModel) {
      return;
    }

    await this.runModelTurnChain({
      projectPath: params.projectPath,
      widgetId: params.widgetId,
      definition: params.definition,
      actors,
      lang: params.lang,
      burstCount: 0,
      bootstrapSession: {
        actor: firstActorId,
        turnIndex: 0,
        lastDataSnapshot: params.incomingData,
      },
    });
  }

  private isSessionBlockingUserStart(session: WidgetSessionData): boolean {
    if (session.phase === 'thinking') {
      return true;
    }
    return (session.moveLog?.length ?? 0) > 0;
  }

  private async isDefinitionEnabled(projectPath: string): Promise<boolean> {
    const definitionPath = `${projectPath}/Definition.md`;
    const file = this.plugin.app.vault.getFileByPath(definitionPath);
    if (!file) {
      return false;
    }

    const cache = this.plugin.app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.enabled !== false;
  }

  private async withProjectLock(projectPath: string, fn: () => Promise<void>): Promise<void> {
    if (this.locks.has(projectPath)) {
      return;
    }

    this.locks.add(projectPath);
    try {
      await fn();
    } catch (error) {
      logger.error('Widget orchestrator error:', error);
    } finally {
      this.locks.delete(projectPath);
    }
  }

  /** Resolves whether an action ends the actor's roster turn (catalog + optional overrides). */
  public resolveActionEndTurn(params: {
    definition: WidgetDefinition | null;
    actionName: string;
    result?: Pick<WidgetActionResult, 'endTurn'>;
    saveMove?: Pick<WidgetStateSaveMove, 'endTurn'>;
  }): boolean {
    return this.resolveEffectiveEndTurn({
      catalogEndTurn: this.resolveCatalogActionEndTurn(params.definition, params.actionName),
      resultEndTurn: params.result?.endTurn,
      saveEndTurn: params.saveMove?.endTurn,
    });
  }

  /** Catalog default for whether an action ends the actor's roster turn. Defaults to true. */
  private resolveCatalogActionEndTurn(
    definition: WidgetDefinition | null,
    actionName: string
  ): boolean {
    const actionDef = definition?.actions?.actions[actionName];
    if (actionDef && actionDef.endTurn === false) {
      return false;
    }
    return true;
  }

  /** Iframe result overrides save metadata overrides catalog default. */
  private resolveEffectiveEndTurn(params: {
    catalogEndTurn: boolean;
    resultEndTurn?: boolean;
    saveEndTurn?: boolean;
  }): boolean {
    if (params.resultEndTurn !== undefined) {
      return params.resultEndTurn;
    }
    if (params.saveEndTurn !== undefined) {
      return params.saveEndTurn;
    }
    return params.catalogEndTurn;
  }
}
