import { WidgetQueryHandler, widgetQuerySchema } from './WidgetQueryHandler';
import type { WidgetQueryArgs } from './WidgetQueryHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { ToolCallPart } from '../../tools/types';
import type { WidgetSessionData } from 'src/services/WidgetService/types';

function createSession(actor: string): WidgetSessionData {
  return {
    conversationTitle: 'chess__session_live',
    actor,
    turnIndex: 1,
    phase: 'thinking',
    moveLog: [],
  };
}

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

  function createHandlerHarness(
    session: WidgetSessionData | null,
    options: { projectPath?: string | null } = {}
  ) {
    const resolvedProjectPath =
      options.projectPath === undefined ? projectPath : options.projectPath;
    const dispatchQuery = jest.fn().mockResolvedValue({ ok: true, data: [1, 2, 3] });
    const serializeInvocation = jest.fn().mockResolvedValue(undefined);
    const updateConversationNote = jest.fn().mockResolvedValue(undefined);

    const getConversationProperty = jest
      .fn()
      .mockImplementation(async (_title: string, key: string) => {
        if (key === 'widget_project_path') {
          return resolvedProjectPath;
        }
        return undefined;
      });

    const agent = {
      renderer: { getConversationProperty },
      plugin: {
        widgetService: {
          stateService: {
            readSession: jest.fn().mockResolvedValue(session ? { ...session } : null),
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

  it('dispatches for the current session actor', async () => {
    const { handler, ctx, toolCall, dispatchQuery, serializeInvocation, updateConversationNote } =
      createHandlerHarness(createSession('black'));

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

  it('rejects when widget project path is missing', async () => {
    const { handler, ctx, toolCall, dispatchQuery, serializeInvocation } = createHandlerHarness(
      createSession('black'),
      { projectPath: null }
    );

    await handler.handle(ctx, { toolCall });

    expect(dispatchQuery).not.toHaveBeenCalled();
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { type: 'error-text', value: 'widget_session_context_missing' },
      })
    );
  });

  it('dispatches when session actor is human without an agent block', async () => {
    const { handler, ctx, toolCall, dispatchQuery, serializeInvocation } = createHandlerHarness(
      createSession('white')
    );

    await handler.handle(ctx, { toolCall });

    expect(dispatchQuery).toHaveBeenCalledWith({
      projectPath,
      query: 'getLegalMoves',
      queryParams: {},
    });
    expect(serializeInvocation.mock.calls[0][0].result.type).toBe('json');
  });

  it('dispatches queries not listed on the current actor agent', async () => {
    const { handler, ctx, toolCall, dispatchQuery } = createHandlerHarness(createSession('black'));

    const customCall = {
      ...toolCall,
      input: { query: 'unknownQuery' },
    } as unknown as ToolCallPart<WidgetQueryArgs>;

    await handler.handle(ctx, { toolCall: customCall });

    expect(dispatchQuery).toHaveBeenCalledWith({
      projectPath,
      query: 'unknownQuery',
      queryParams: {},
    });
  });

  it('dispatches get_state when session is missing', async () => {
    const { handler, ctx, serializeInvocation, dispatchQuery } = createHandlerHarness(null);

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
    expect(serializeInvocation.mock.calls[0][0].result.type).toBe('json');
  });
});
