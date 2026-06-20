import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import type {
  WidgetActors,
  WidgetDefinition,
  WidgetSessionData,
  WidgetStateSaveOptions,
} from './types';
import { WidgetSessionService } from './WidgetSessionService';
import { WidgetStateService } from './WidgetStateService';
import { WidgetDefinitionService } from './WidgetDefinitionService';

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
 * Session is persisted only when a model turn runs (not on widget mount).
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

  public async handleMount(params: {
    projectPath: string;
    widgetId: string;
    lang?: string | null;
  }): Promise<void> {
    await this.withProjectLock(params.projectPath, async () => {
      const definition = await this.definitionService.getWidgetDefinition(params.projectPath);
      if (Object.keys(definition.agents).length === 0 || !definition.actors) {
        return;
      }

      if (!(await this.isDefinitionEnabled(params.projectPath))) {
        return;
      }

      const actors = definition.actors;
      const session = await this.stateService.readSession(params.projectPath);

      if (session) {
        const actorEntry = actors.actors[session.actor];
        if (!actorEntry) {
          return;
        }

        const isFreshSession = session.turnIndex === 0 && (session.moveLog?.length ?? 0) === 0;
        const shouldAutoStart =
          actors.mode === 'models_only' || (isFreshSession && actorEntry.kind === 'model');
        if (!shouldAutoStart) {
          return;
        }

        await this.runModelTurnChain({
          projectPath: params.projectPath,
          widgetId: params.widgetId,
          definition,
          actors,
          lang: params.lang,
          burstCount: 0,
        });
        return;
      }

      const firstActorId = actors.turnOrder[0];
      const firstEntry = actors.actors[firstActorId];
      const shouldAutoStart = actors.mode === 'models_only' || firstEntry?.kind === 'model';
      if (!shouldAutoStart) {
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
          actor: firstActorId,
          turnIndex: 0,
        },
      });
    });
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

    if (this.isSessionResetRequest(params.saveOptions)) {
      await this.stateService.clearSession(params.projectPath);
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

    if (actorEntry.kind === 'human') {
      workingSession = this.advanceTurn({
        session: workingSession,
        turnOrder: definition.actors.turnOrder,
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
        moveLog: [],
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

    // The widget_action handler advances the roster the moment a valid move is
    // applied, so an unchanged turnIndex means no move landed this turn.
    const moveApplied = currentSession.turnIndex !== turnIndexBeforeTurn;
    if (!turnResult.ok || !moveApplied) {
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
  }): WidgetSessionData {
    const moveLog = [...(params.session.moveLog ?? [])];
    moveLog.push({
      actor: params.actingActorId,
      action: 'unknown',
      at: new Date().toISOString(),
    });

    return this.advanceTurn({
      session: {
        ...params.session,
        moveLog,
        phase: 'awaiting_input',
      },
      turnOrder: params.turnOrder,
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
    return saveOptions?.intent === 'reset';
  }

  private async isDefinitionEnabled(projectPath: string): Promise<boolean> {
    const definitionPath = `${projectPath}/Widget.md`;
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
}
