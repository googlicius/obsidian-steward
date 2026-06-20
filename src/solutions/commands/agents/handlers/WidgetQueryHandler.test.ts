import { WidgetQueryHandler, widgetQuerySchema } from './WidgetQueryHandler';
import type { WidgetQueryArgs } from './WidgetQueryHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { ToolCallPart } from '../../tools/types';

describe('widgetQuerySchema', () => {
  it('accepts query name and optional params', () => {
    const result = widgetQuerySchema.safeParse({
      query: 'getLegalMoves',
      params: { depth: 2 },
    });

    expect(result.success).toBe(true);
  });

  it('defaults query to get_state when omitted', () => {
    const result = widgetQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query).toBe('get_state');
    }
  });
});

describe('WidgetQueryHandler', () => {
  const projectPath = 'Steward/Widgets/chess';
  const actorId = 'black';

  const definition = {
    actors: { turnOrder: ['white', 'black'] },
    agents: {
      black: {
        actions: ['movePiece'],
        queries: ['getLegalMoves', 'evaluatePosition'],
      },
    },
    queries: {
      queries: {
        getLegalMoves: { description: 'Legal moves' },
        evaluatePosition: { description: 'Score' },
      },
    },
  };

  function createHandlerHarness(currentActor: string) {
    const dispatchQuery = jest.fn().mockResolvedValue({ ok: true, data: [1, 2, 3] });
    const serializeInvocation = jest.fn().mockResolvedValue(undefined);
    const updateConversationNote = jest.fn().mockResolvedValue(undefined);

    const getConversationProperty = jest
      .fn()
      .mockImplementation(async (_title: string, key: string) => {
        if (key === 'widget_project_path') {
          return projectPath;
        }
        if (key === 'widget_actor_id') {
          return actorId;
        }
        return undefined;
      });

    const agent = {
      renderer: { getConversationProperty },
      plugin: {
        widgetService: {
          definitionService: {
            getWidgetDefinition: jest.fn().mockResolvedValue(definition),
          },
          stateService: {
            readSession: jest.fn().mockResolvedValue({
              conversationTitle: 'chess__session_live',
              actor: currentActor,
              turnIndex: 1,
              phase: 'thinking',
              moveLog: [],
            }),
          },
          dispatchQuery,
        },
      },
    } as unknown as AgentHandlerContext;

    const handler = new WidgetQueryHandler(agent);
    const ctx = {
      agentHandlerParams: { title: 'chess__session_live' },
      lang: 'en',
      serializeInvocation,
      updateConversationNote,
    } as unknown as HandlerInvocationContext;

    const toolCall = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'widget_query',
      input: { query: 'getLegalMoves' },
    } as unknown as ToolCallPart<WidgetQueryArgs>;

    return { handler, ctx, toolCall, dispatchQuery, serializeInvocation, updateConversationNote };
  }

  it('dispatches when it is the actor turn', async () => {
    const { handler, ctx, toolCall, dispatchQuery, serializeInvocation, updateConversationNote } =
      createHandlerHarness('black');

    await handler.handle(ctx, { toolCall });

    expect(dispatchQuery).toHaveBeenCalledWith({
      projectPath,
      query: 'getLegalMoves',
      queryParams: {},
    });
    expect(updateConversationNote).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Steward',
        includeHistory: false,
        newContent: 'translated_widget.sessionQuery',
      })
    );
    const okResult = serializeInvocation.mock.calls[0][0].result;
    expect(okResult.type).toBe('json');
    expect(okResult.value).toEqual([1, 2, 3]);
  });

  it('dispatches even when it is not the actor turn', async () => {
    const { handler, ctx, toolCall, dispatchQuery, serializeInvocation, updateConversationNote } =
      createHandlerHarness('white');

    await handler.handle(ctx, { toolCall });

    expect(dispatchQuery).toHaveBeenCalledWith({
      projectPath,
      query: 'getLegalMoves',
      queryParams: {},
    });
    expect(updateConversationNote).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Steward',
        includeHistory: false,
        newContent: 'translated_widget.sessionQuery',
      })
    );
    expect(serializeInvocation.mock.calls[0][0].result.type).toBe('json');
  });

  it('rejects queries not allowed for the actor', async () => {
    const { handler, ctx, toolCall, dispatchQuery, serializeInvocation } =
      createHandlerHarness('black');

    const disallowedCall = {
      ...toolCall,
      input: { query: 'unknownQuery' },
    } as unknown as ToolCallPart<WidgetQueryArgs>;

    await handler.handle(ctx, { toolCall: disallowedCall });

    expect(dispatchQuery).not.toHaveBeenCalled();
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { type: 'error-text', value: 'query_not_allowed:unknownQuery' },
      })
    );
  });

  it('allows get_state without listing it on the agent', async () => {
    const { handler, ctx, serializeInvocation, dispatchQuery, updateConversationNote } =
      createHandlerHarness('black');

    const getStateCall = {
      type: 'tool-call',
      toolCallId: 'call-2',
      toolName: 'widget_query',
      input: {},
    } as unknown as ToolCallPart<WidgetQueryArgs>;

    await handler.handle(ctx, { toolCall: getStateCall });

    expect(dispatchQuery).toHaveBeenCalledWith({
      projectPath,
      query: 'get_state',
      queryParams: {},
    });
    expect(updateConversationNote).toHaveBeenCalledWith(
      expect.objectContaining({
        newContent: 'translated_widget.sessionQuery',
      })
    );
    expect(serializeInvocation.mock.calls[0][0].result.type).toBe('json');
  });
});
