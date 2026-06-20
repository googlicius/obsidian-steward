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
    buildTurnContext: service['buildTurnContext'].bind(service) as WidgetSessionService['buildTurnContext'],
    resolveActorTools: service['resolveActorTools'].bind(service) as WidgetSessionService['resolveActorTools'],
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

  describe('buildTurnContext', () => {
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

    it('lists get_state and agent queries without embedding state', () => {
      const text = buildTurnContext({
        agent,
        definition,
        moveLog: [],
      });

      expect(text).toContain('## Available queries');
      expect(text).toContain(`\`${DEFAULT_WIDGET_QUERY_NAME}\``);
      expect(text).toContain('`text_representation`');
      expect(text).not.toContain('```json');
      expect(text).not.toContain('```text');
      expect(text).toContain('defaults to `get_state`');
    });

    it('lists allowed actions and recent moves', () => {
      const text = buildTurnContext({
        agent,
        definition,
        moveLog: [{ actor: 'user', action: 'playCell', at: '2026-01-01T00:00:00.000Z' }],
      });

      expect(text).toContain('## Allowed actions');
      expect(text).toContain('`playCell`');
      expect(text).toContain('## Recent moves');
      expect(text).toContain('user: playCell');
    });
  });

  describe('resolveActorTools', () => {
    it('always includes widget_action and widget_query', () => {
      const tools = resolveActorTools(undefined);
      expect(tools).toContain(ToolName.WIDGET_ACTION);
      expect(tools).toContain(ToolName.WIDGET_QUERY);
    });

    it('includes tools from the agent block', () => {
      const agent: WidgetAgent = {
        name: 'agent',
        id: 'o',
        instructions: ['Play O'],
        actions: ['playCell'],
        tools: [ToolName.CONTENT_READING, ToolName.WIDGET_ACTION, ToolName.SEARCH],
      };

      const tools = resolveActorTools(agent);
      expect(tools).toContain(ToolName.WIDGET_ACTION);
      expect(tools).toContain(ToolName.WIDGET_QUERY);
      expect(tools).toContain(ToolName.CONTENT_READING);
      expect(tools).toContain(ToolName.SEARCH);
    });
  });
});
