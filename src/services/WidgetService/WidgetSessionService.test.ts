import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { WidgetSessionService } from './WidgetSessionService';
import type { WidgetAgent, WidgetDefinition } from './types';
import { DEFAULT_WIDGET_QUERY_NAME } from './types';

function createMockPlugin(overrides?: Partial<StewardPlugin>): jest.Mocked<StewardPlugin> {
  return {
    widgetService: overrides?.widgetService,
    conversationRenderer: overrides?.conversationRenderer,
    noteContentService: {
      transformHeadingOnlyWikilinks: jest.fn(text => text),
    },
    userDefinedCommandService: {
      processSystemPromptsWikilinks: jest.fn((prompts: string[]) => Promise.resolve(prompts)),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

function bindPrivateMethods(service: WidgetSessionService) {
  return {
    buildTurnContext: service['buildTurnContext'].bind(
      service
    ) as WidgetSessionService['buildTurnContext'],
    resolveActorTools: service['resolveActorTools'].bind(
      service
    ) as WidgetSessionService['resolveActorTools'],
    formatMoveLogAction: WidgetSessionService['formatMoveLogAction'].bind(
      WidgetSessionService
    ) as (typeof WidgetSessionService)['formatMoveLogAction'],
  };
}

describe('WidgetSessionService turn context helpers', () => {
  let service: WidgetSessionService;
  let buildTurnContext: WidgetSessionService['buildTurnContext'];
  let resolveActorTools: WidgetSessionService['resolveActorTools'];

  beforeEach(() => {
    (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance = null;
    service = WidgetSessionService.getInstance(createMockPlugin());
    const bound = bindPrivateMethods(service);
    buildTurnContext = bound.buildTurnContext;
    resolveActorTools = bound.resolveActorTools;
  });

  describe('resolveWidgetContext', () => {
    const projectPath = 'Steward/Widgets/test';
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

    it('returns system prompts and extra core prompt sections', async () => {
      (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance =
        null;
      const plugin = createMockPlugin({
        widgetService: {
          definitionService: {
            getWidgetDefinition: jest.fn().mockResolvedValue(definition),
          },
        } as unknown as StewardPlugin['widgetService'],
      });
      service = WidgetSessionService.getInstance(plugin);

      const result = await service.resolveWidgetContext({ projectPath, actorId: 'o' });

      expect(result).not.toBeNull();
      expect(result!.systemPrompts).toEqual(['Play O']);
      expect(result!.extraCorePromptSections).toHaveLength(2);
      expect(result!.extraCorePromptSections[0].heading).toBe('## Available queries');
      expect(result!.extraCorePromptSections[0].body).toContain(`\`${DEFAULT_WIDGET_QUERY_NAME}\``);
      expect(result!.extraCorePromptSections[0].body).toContain('`text_representation`');
      expect(result!.extraCorePromptSections[1].heading).toBe('## Allowed actions');
      expect(result!.extraCorePromptSections[1].body).toContain('`playCell`');
      expect(result!.extraCorePromptSections[1].body).toContain('Play in a cell');
    });

    it('returns null when actor id is not in the definition', async () => {
      (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance =
        null;
      const plugin = createMockPlugin({
        widgetService: {
          definitionService: {
            getWidgetDefinition: jest.fn().mockResolvedValue(definition),
          },
        } as unknown as StewardPlugin['widgetService'],
      });
      service = WidgetSessionService.getInstance(plugin);

      const result = await service.resolveWidgetContext({
        projectPath,
        actorId: 'nonexistent',
      });

      expect(result).toBeNull();
    });

    it('returns null when definition has no agents', async () => {
      (WidgetSessionService as unknown as { instance: WidgetSessionService | null }).instance =
        null;
      const emptyDef: WidgetDefinition = {
        manifest: null,
        actions: null,
        queries: null,
        actors: null,
        agents: {},
      };
      const plugin = createMockPlugin({
        widgetService: {
          definitionService: {
            getWidgetDefinition: jest.fn().mockResolvedValue(emptyDef),
          },
        } as unknown as StewardPlugin['widgetService'],
      });
      service = WidgetSessionService.getInstance(plugin);

      const result = await service.resolveWidgetContext({ projectPath, actorId: 'o' });

      expect(result).toBeNull();
    });
  });

  describe('buildTurnContext', () => {
    it('includes actor identity and turn guidance', () => {
      const text = buildTurnContext({ actorId: 'o', moveLog: [] });

      expect(text).toContain('You are actor `o`');
      expect(text).not.toContain('actorId:');
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
  let formatMoveLogAction: (typeof WidgetSessionService)['formatMoveLogAction'];

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
    it('parses reset_and_start intent', () => {
      expect(
        WidgetSessionService.parseWidgetStateSaveOptions({
          intent: 'reset_and_start',
        })
      ).toEqual({
        intent: 'reset_and_start',
      });
    });

    it('parses start intent', () => {
      expect(
        WidgetSessionService.parseWidgetStateSaveOptions({
          intent: 'start',
        })
      ).toEqual({
        intent: 'start',
      });
    });

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

    it('parses model_dispatch source', () => {
      expect(
        WidgetSessionService.parseWidgetStateSaveOptions({
          move: { action: 'playCell', params: { index: 190 } },
          source: 'model_dispatch',
        })
      ).toEqual({
        move: { action: 'playCell', params: { index: 190 } },
        source: 'model_dispatch',
      });
    });
  });
});
