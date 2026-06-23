import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { WidgetSessionService } from './WidgetSessionService';
import type { WidgetAgent, WidgetDefinition } from './types';
import { DEFAULT_WIDGET_QUERY_NAME } from './types';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {} as unknown as jest.Mocked<StewardPlugin>;
}

function bindPrivateMethods(service: WidgetSessionService) {
  return {
    buildTurnContext: service['buildTurnContext'].bind(
      service
    ) as WidgetSessionService['buildTurnContext'],
    buildActorExtraCorePromptSections: service['buildActorExtraCorePromptSections'].bind(
      service
    ) as WidgetSessionService['buildActorExtraCorePromptSections'],
    resolveActorTools: service['resolveActorTools'].bind(
      service
    ) as WidgetSessionService['resolveActorTools'],
    formatMoveLogAction: WidgetSessionService['formatMoveLogAction'].bind(
      WidgetSessionService
    ) as typeof WidgetSessionService['formatMoveLogAction'],
  };
}

describe('WidgetSessionService turn context helpers', () => {
  let service: WidgetSessionService;
  let buildTurnContext: WidgetSessionService['buildTurnContext'];
  let buildActorExtraCorePromptSections: WidgetSessionService['buildActorExtraCorePromptSections'];
  let resolveActorTools: WidgetSessionService['resolveActorTools'];

  const agent: WidgetAgent = {
    name: 'agent',
    id: 'o',
    instructions: ['Play O'],
    actions: ['playCell'],
    queries: ['text_representation'],
  };

  const definition: WidgetDefinition = {
    manifest: null,
    actions: {
      name: 'actions',
      actions: { playCell: { description: 'Play in a cell' } },
    },
    queries: {
      name: 'queries',
      queries: {
        text_representation: { description: 'ASCII board view' },
      },
    },
    actors: null,
    agents: { o: agent },
  };

  beforeEach(() => {
    (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance = null;
    service = WidgetSessionService.getInstance(createMockPlugin());
    const bound = bindPrivateMethods(service);
    buildTurnContext = bound.buildTurnContext;
    buildActorExtraCorePromptSections = bound.buildActorExtraCorePromptSections;
    resolveActorTools = bound.resolveActorTools;
  });

  describe('buildActorExtraCorePromptSections', () => {
    it('lists get_state and agent queries with descriptions', () => {
      const sections = buildActorExtraCorePromptSections({ agent, definition });

      expect(sections).toHaveLength(2);
      expect(sections[0].heading).toBe('## Available queries');
      expect(sections[0].body).toContain(`\`${DEFAULT_WIDGET_QUERY_NAME}\``);
      expect(sections[0].body).toContain('`text_representation`');
      expect(sections[1].heading).toBe('## Allowed actions');
      expect(sections[1].body).toContain('`playCell`');
      expect(sections[1].body).toContain('Play in a cell');
    });
  });

  describe('buildTurnContext', () => {
    it('includes actorId instruction and turn guidance', () => {
      const text = buildTurnContext({ actorId: 'o', moveLog: [] });

      expect(text).toContain('You are actor `o`');
      expect(text).toContain('actorId: "o"');
      expect(text).not.toContain('## Available queries');
      expect(text).not.toContain('## Allowed actions');
      expect(text).toContain('defaults to `get_state`');
    });

    it('includes recent moves with formatted params', () => {
      const text = buildTurnContext({
        actorId: 'o',
        moveLog: [
          { actor: 'user', action: 'playCell(index=185)', at: '2026-01-01T00:00:00.000Z' },
          { actor: 'o', action: 'playCell(index=206)', at: '2026-01-01T00:00:01.000Z' },
        ],
      });

      expect(text).toContain('## Recent moves');
      expect(text).toContain('user: playCell(index=185)');
      expect(text).toContain('o: playCell(index=206)');
    });
  });

  describe('resolveActorTools', () => {
    it('always includes widget_action and widget_query', () => {
      const tools = resolveActorTools(undefined);
      expect(tools).toContain(ToolName.WIDGET_ACTION);
      expect(tools).toContain(ToolName.WIDGET_QUERY);
    });

    it('includes tools from the agent block', () => {
      const agentWithTools: WidgetAgent = {
        name: 'agent',
        id: 'o',
        instructions: ['Play O'],
        actions: ['playCell'],
        tools: [ToolName.CONTENT_READING, ToolName.WIDGET_ACTION, ToolName.SEARCH],
      };

      const tools = resolveActorTools(agentWithTools);
      expect(tools).toContain(ToolName.WIDGET_ACTION);
      expect(tools).toContain(ToolName.WIDGET_QUERY);
      expect(tools).toContain(ToolName.CONTENT_READING);
      expect(tools).toContain(ToolName.SEARCH);
    });
  });
});

describe('WidgetSessionService session move helpers', () => {
  let service: WidgetSessionService;
  let formatMoveLogAction: typeof WidgetSessionService['formatMoveLogAction'];

  beforeEach(() => {
    (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance = null;
    service = WidgetSessionService.getInstance(createMockPlugin());
    formatMoveLogAction = bindPrivateMethods(service).formatMoveLogAction;
  });

  describe('formatMoveLogAction', () => {
    it('returns action name when params are absent', () => {
      expect(formatMoveLogAction('playCell')).toBe('playCell');
    });

    it('formats params in stable key order', () => {
      expect(formatMoveLogAction('playCell', { index: 185 })).toBe('playCell(index=185)');
    });
  });

  describe('appendMoveAndMaybeAdvanceSession', () => {
    it('appends move without advancing when endTurn is false', () => {
      const next = service.appendMoveAndMaybeAdvanceSession({
        session: {
          conversationTitle: 'test__session',
          actor: 'o',
          turnIndex: 1,
          phase: 'thinking',
          moveLog: [],
        },
        actorId: 'o',
        action: 'undo',
        turnOrder: ['user', 'o'],
        endTurn: false,
      });

      expect(next.actor).toBe('o');
      expect(next.turnIndex).toBe(1);
      expect(next.moveLog).toHaveLength(1);
    });

    it('advances roster when endTurn is true', () => {
      const next = service.appendMoveAndMaybeAdvanceSession({
        session: {
          conversationTitle: 'test__session',
          actor: 'o',
          turnIndex: 1,
          phase: 'thinking',
          moveLog: [],
        },
        actorId: 'o',
        action: 'playCell',
        moveParams: { index: 0 },
        turnOrder: ['user', 'o'],
        endTurn: true,
      });

      expect(next.actor).toBe('user');
      expect(next.turnIndex).toBe(0);
    });
  });

  describe('appendMoveAndAdvanceSession', () => {
    it('appends formatted move and advances actor', () => {
      const next = service.appendMoveAndAdvanceSession({
        session: {
          conversationTitle: 'test__session',
          actor: 'user',
          turnIndex: 0,
          phase: 'awaiting_input',
          moveLog: [],
        },
        actorId: 'user',
        action: 'playCell',
        moveParams: { index: 0 },
        turnOrder: ['user', 'o'],
      });

      expect(next.actor).toBe('o');
      expect(next.turnIndex).toBe(1);
      expect(next.moveLog).toEqual([
        expect.objectContaining({
          actor: 'user',
          action: 'playCell(index=0)',
        }),
      ]);
    });
  });

  describe('createMoveLogEntry', () => {
    it('builds a move log row without advancing session', () => {
      expect(
        service.createMoveLogEntry({
          actorId: 'user',
          action: 'playCell',
          moveParams: { index: 4 },
          at: '2026-06-21T00:00:00.000Z',
        })
      ).toEqual({
        actor: 'user',
        action: 'playCell(index=4)',
        at: '2026-06-21T00:00:00.000Z',
      });
    });
  });

  describe('parseWidgetStateSaveOptions', () => {
    it('parses reset intent and move metadata', () => {
      expect(
        WidgetSessionService.parseWidgetStateSaveOptions({
          intent: 'reset',
          move: { action: 'playCell', params: { index: 2 }, comment: 'block' },
        })
      ).toEqual({
        intent: 'reset',
        move: { action: 'playCell', params: { index: 2 }, comment: 'block' },
      });
    });
  });
});
