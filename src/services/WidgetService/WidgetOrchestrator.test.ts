import { WidgetOrchestrator } from './WidgetOrchestrator';
import type { WidgetDefinition, WidgetSessionData } from './types';

const projectPath = 'Steward/Widgets/tic-tac-toe';
const widgetId = 'tic-tac-toe';

const definition: WidgetDefinition = {
  manifest: null,
  actions: {
    name: 'actions',
    actions: {
      playCell: {
        description: 'Place mark',
        params: {
          index: { type: 'integer', minimum: 0, maximum: 8 },
        },
      },
    },
  },
  actors: {
    name: 'actors',
    mode: 'user_and_models',
    turnOrder: ['user', 'o'],
    actors: {
      user: { kind: 'human' },
      o: { kind: 'model' },
    },
  },
  agents: {
    o: {
      name: 'agent',
      id: 'o',
      instructions: ['Play O'],
      actions: ['playCell'],
    },
  },
};

function resetOrchestratorSingleton(): void {
  (WidgetOrchestrator as unknown as { instance: WidgetOrchestrator | null }).instance = null;
}

function createOrchestratorHarness(options: {
  initialSession: WidgetSessionData | null;
  initialData?: unknown;
}) {
  let session: WidgetSessionData | null = options.initialSession
    ? { ...options.initialSession }
    : null;
  let data: unknown = options.initialData ?? { board: Array(9).fill(null), current: 'X' };

  const clearSession = jest.fn().mockImplementation(async () => {
    session = null;
  });
  const writeState = jest.fn().mockImplementation(async (params: { data: unknown }) => {
    data = params.data;
  });
  const writeSession = jest
    .fn()
    .mockImplementation(async (params: { session: WidgetSessionData }) => {
      session = { ...params.session };
    });
  const readSession = jest.fn().mockImplementation(async () => (session ? { ...session } : null));
  const readState = jest.fn().mockImplementation(async () => ({
    version: 1 as const,
    updatedAt: '2026-06-17T00:00:00.000Z',
    data,
    ...(session ? { session: { ...session } } : {}),
  }));
  // Mirrors the widget_action handler: a successful model turn advances the
  // roster (append moveLog + next actor) before the orchestrator regains control.
  const runActorTurn = jest.fn().mockImplementation(async () => {
    if (session) {
      const turnOrder = definition.actors?.turnOrder ?? [];
      const nextIndex = turnOrder.length
        ? (session.turnIndex + 1) % turnOrder.length
        : session.turnIndex;
      session = {
        ...session,
        moveLog: [
          ...(session.moveLog ?? []),
          { actor: session.actor, action: 'playCell', at: '2026-06-17T00:00:00.000Z' },
        ],
        turnIndex: nextIndex,
        actor: turnOrder[nextIndex] ?? session.actor,
      };
    }
    return { ok: true };
  });
  const createSessionForModelTurn = jest
    .fn()
    .mockImplementation(
      async (params: {
        actorId: string;
        turnIndex: number;
        moveLog?: WidgetSessionData['moveLog'];
        lastDataSnapshot?: unknown;
      }) => {
        session = {
          conversationTitle: 'tic-tac-toe__session_new',
          actor: params.actorId,
          turnIndex: params.turnIndex,
          phase: 'awaiting_input',
          moveLog: params.moveLog ?? [],
          ...(params.lastDataSnapshot !== undefined
            ? { lastDataSnapshot: params.lastDataSnapshot }
            : {}),
        };
        return session;
      }
    );

  const plugin = {
    app: {
      vault: {
        getFileByPath: () => ({ path: `${projectPath}/Widget.md` }),
      },
      metadataCache: {
        getFileCache: () => ({ frontmatter: { enabled: true, status: 'Valid' } }),
      },
    },
    widgetService: {
      sessionService: {
        runActorTurn,
        createSessionForModelTurn,
        appendHumanMoveMessage: jest.fn(),
      },
      stateService: {
        writeState,
        writeSession,
        readSession,
        readState,
        clearSession,
      },
      definitionService: {
        getWidgetDefinition: jest.fn().mockResolvedValue(definition),
      },
    },
  } as never;

  const orchestrator = WidgetOrchestrator.getInstance(plugin);
  return {
    orchestrator,
    writeSession,
    clearSession,
    runActorTurn,
    createSessionForModelTurn,
    getSession: () => (session ? { ...session } : null),
  };
}

describe('WidgetOrchestrator', () => {
  beforeEach(() => {
    resetOrchestratorSingleton();
  });

  it('does not create session on mount for human-first widgets', async () => {
    const { orchestrator, createSessionForModelTurn, runActorTurn } = createOrchestratorHarness({
      initialSession: null,
    });

    await orchestrator.handleMount({ projectPath, widgetId });

    expect(createSessionForModelTurn).not.toHaveBeenCalled();
    expect(runActorTurn).not.toHaveBeenCalled();
  });

  it('creates session and runs model on first human move when no session exists', async () => {
    const { orchestrator, createSessionForModelTurn, runActorTurn, getSession } =
      createOrchestratorHarness({
        initialSession: null,
        initialData: { board: Array(9).fill(null), current: 'X' },
      });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: ['X', null, null, null, null, null, null, null, null],
        current: 'O',
      },
    });

    expect(createSessionForModelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'o',
        turnIndex: 1,
      })
    );
    expect(runActorTurn).toHaveBeenCalled();
    expect(getSession()?.actor).toBe('user');
  });

  it('skips human turn advance when suppressHumanAdvanceOnce is set', async () => {
    const { orchestrator, writeSession, runActorTurn } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'tic-tac-toe__session_new',
        actor: 'user',
        turnIndex: 0,
        phase: 'awaiting_input',
        moveLog: [],
        lastDataSnapshot: {
          board: ['X', 'O', null, null, null, null, null, null, null],
          current: 'X',
        },
        suppressHumanAdvanceOnce: true,
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: { board: Array(9).fill(null), current: 'X' },
    });

    expect(writeSession).toHaveBeenCalledWith({
      projectPath,
      session: expect.objectContaining({
        actor: 'user',
        turnIndex: 0,
        suppressHumanAdvanceOnce: false,
      }),
    });
    expect(runActorTurn).not.toHaveBeenCalled();
  });

  it('clears session when setState uses reset intent on human actor turn', async () => {
    const { orchestrator, clearSession, runActorTurn, getSession } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'tic-tac-toe__session_live',
        actor: 'user',
        turnIndex: 0,
        phase: 'awaiting_input',
        moveLog: [{ actor: 'user', action: 'playCell', at: '2026-06-17T00:00:00.000Z' }],
        lastDataSnapshot: {
          board: ['X', 'O', 'X', null, 'O', null, null, null, null],
          current: 'X',
        },
      },
      initialData: {
        board: ['X', 'O', 'X', null, 'O', null, null, null, null],
        current: 'X',
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: { board: Array(9).fill(null), current: 'X' },
      saveOptions: { intent: 'reset' },
    });

    expect(clearSession).toHaveBeenCalledWith(projectPath);
    expect(runActorTurn).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
  });

  it('clears session when setState uses reset intent on model actor turn', async () => {
    const { orchestrator, clearSession, runActorTurn, getSession } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'tic-tac-toe__session_live',
        actor: 'o',
        turnIndex: 1,
        phase: 'awaiting_input',
        moveLog: [{ actor: 'o', action: 'playCell', at: '2026-06-17T00:00:00.000Z' }],
        lastDataSnapshot: {
          board: ['X', 'O', 'X', null, 'O', null, null, null, null],
          current: 'X',
        },
      },
      initialData: {
        board: ['X', 'O', 'X', null, 'O', null, null, null, null],
        current: 'X',
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: Array(9).fill(null),
        current: 'X',
        winner: null,
        winLine: null,
        isDraw: false,
      },
      saveOptions: { intent: 'reset' },
    });

    expect(clearSession).toHaveBeenCalledWith(projectPath);
    expect(runActorTurn).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
  });

  it('clears session when setState uses reset intent for chess new game', async () => {
    const playedBoard = [
      ['br', 'bn', 'bb', 'bq', 'bk', 'bb', 'bn', 'br'],
      ['bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp', 'bp'],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null, null],
      ['wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp', 'wp'],
      ['wr', 'wn', 'wb', 'wq', 'wk', 'wb', 'wn', 'wr'],
    ];

    const { orchestrator, clearSession, runActorTurn, getSession } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'chess__session_live',
        actor: 'black',
        turnIndex: 1,
        phase: 'awaiting_input',
        moveLog: [],
        lastDataSnapshot: {
          board: playedBoard,
          turn: 'b',
          moveHistory: ['e2e4', 'e7e5'],
          status: 'playing',
        },
      },
      initialData: {
        board: playedBoard,
        turn: 'b',
        moveHistory: ['e2e4', 'e7e5'],
        status: 'playing',
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: playedBoard,
        turn: 'w',
        selected: null,
        legalTargets: [],
        lastMove: null,
        moveHistory: [],
        status: 'playing',
        winner: null,
        pendingPromotion: null,
      },
      saveOptions: { intent: 'reset' },
    });

    expect(clearSession).toHaveBeenCalledWith(projectPath);
    expect(runActorTurn).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
  });

  it('does not clear session on reset intent when no session exists', async () => {
    const { orchestrator, clearSession, runActorTurn, createSessionForModelTurn } =
      createOrchestratorHarness({
        initialSession: null,
        initialData: { board: ['X', 'O', null, null, null, null, null, null, null], current: 'O' },
      });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: { board: Array(9).fill(null), current: 'X' },
      saveOptions: { intent: 'reset' },
    });

    expect(clearSession).toHaveBeenCalledWith(projectPath);
    expect(createSessionForModelTurn).not.toHaveBeenCalled();
    expect(runActorTurn).not.toHaveBeenCalled();
  });

  it('advances to model after a normal human move when session exists', async () => {
    const { orchestrator, writeSession, runActorTurn, getSession } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'tic-tac-toe__session_live',
        actor: 'user',
        turnIndex: 0,
        phase: 'awaiting_input',
        moveLog: [],
        lastDataSnapshot: { board: Array(9).fill(null), current: 'X' },
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: ['X', null, null, null, null, null, null, null, null],
        current: 'O',
      },
    });

    expect(writeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath,
        session: expect.objectContaining({
          actor: 'o',
          turnIndex: 1,
        }),
      })
    );
    expect(runActorTurn).toHaveBeenCalled();
    expect(getSession()?.phase).toBe('awaiting_input');
  });

  it('reconciles session when model actor save changes board after failed orchestrator turn', async () => {
    const { orchestrator, runActorTurn, getSession } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'tic-tac-toe__session_live',
        actor: 'o',
        turnIndex: 1,
        phase: 'awaiting_input',
        moveLog: [{ actor: 'user', action: 'playCell', at: '2026-06-17T00:00:00.000Z' }],
        lastDataSnapshot: {
          board: ['X', null, null, null, null, null, null, null, null],
          current: 'O',
        },
      },
      initialData: {
        board: ['X', null, null, null, null, null, null, null, null],
        current: 'O',
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: ['X', 'O', null, null, null, null, null, null, null],
        current: 'X',
      },
    });

    expect(runActorTurn).not.toHaveBeenCalled();
    const session = getSession();
    expect(session?.actor).toBe('user');
    expect(session?.turnIndex).toBe(0);
    expect(session?.moveLog).toHaveLength(2);
    expect(session?.moveLog?.[1]).toEqual(
      expect.objectContaining({ actor: 'o', action: 'unknown' })
    );
  });

  it('runs model turn after human move once session was reconciled from external model save', async () => {
    const { orchestrator, runActorTurn, getSession } = createOrchestratorHarness({
      initialSession: {
        conversationTitle: 'tic-tac-toe__session_live',
        actor: 'o',
        turnIndex: 1,
        phase: 'awaiting_input',
        moveLog: [{ actor: 'user', action: 'playCell', at: '2026-06-17T00:00:00.000Z' }],
        lastDataSnapshot: {
          board: ['X', null, null, null, null, null, null, null, null],
          current: 'O',
        },
      },
      initialData: {
        board: ['X', null, null, null, null, null, null, null, null],
        current: 'O',
      },
    });

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: ['X', 'O', null, null, null, null, null, null, null],
        current: 'X',
      },
    });

    runActorTurn.mockClear();

    await orchestrator.handleStateSave({
      projectPath,
      widgetId,
      incomingData: {
        board: ['X', 'O', 'X', null, null, null, null, null, null],
        current: 'O',
      },
    });

    expect(runActorTurn).toHaveBeenCalled();
    expect(getSession()?.actor).toBe('user');
  });
});
