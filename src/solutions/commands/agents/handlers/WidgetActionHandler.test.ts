import { WidgetActionHandler, widgetActionSchema } from './WidgetActionHandler';
import type { WidgetActionArgs } from './WidgetActionHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { ToolCallPart } from '../../tools/types';

describe('widgetActionSchema', () => {
  it('accepts action with optional params and comment', () => {
    const result = widgetActionSchema.safeParse({
      action: 'playCell',
      params: { index: 0 },
      comment: 'Blocking',
    });

    expect(result.success).toBe(true);
  });
});

describe('WidgetActionHandler turn gate', () => {
  const projectPath = 'Steward/Widgets/tic-tac-toe';
  const actorId = 'o';

  const definition = {
    actors: { turnOrder: ['user', 'o'] },
    agents: { o: { actions: ['playCell'] } },
  };

  function createHandlerHarness(currentActor: string) {
    const applyAction = jest.fn().mockResolvedValue({ ok: true });
    const recordMoveAndAdvance = jest.fn().mockResolvedValue(undefined);
    const updateConversationNote = jest.fn().mockResolvedValue(undefined);
    const serializeInvocation = jest.fn().mockResolvedValue(undefined);

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
              conversationTitle: 'tic-tac-toe__session_live',
              actor: currentActor,
              turnIndex: 1,
              phase: 'thinking',
              moveLog: [],
            }),
          },
          sessionService: {
            recordMoveAndAdvance,
          },
          applyAction,
        },
      },
    } as unknown as AgentHandlerContext;

    const handler = new WidgetActionHandler(agent);
    const ctx = {
      agentHandlerParams: { title: 'tic-tac-toe__session_live' },
      lang: 'en',
      serializeInvocation,
      updateConversationNote,
    } as unknown as HandlerInvocationContext;

    const toolCall = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'widget_action',
      input: { action: 'playCell', params: { index: 0 } },
    } as unknown as ToolCallPart<WidgetActionArgs>;

    return {
      handler,
      ctx,
      toolCall,
      applyAction,
      recordMoveAndAdvance,
      serializeInvocation,
      updateConversationNote,
    };
  }

  it('appends a move summary when the model includes a comment', async () => {
    const { handler, ctx, toolCall, updateConversationNote } = createHandlerHarness('o');

    const commentedCall = {
      ...toolCall,
      input: {
        action: 'playCell',
        params: { index: 0 },
        comment: 'Place O near the center to establish control.',
      },
    } as unknown as ToolCallPart<WidgetActionArgs>;

    await handler.handle(ctx, { toolCall: commentedCall });

    expect(updateConversationNote).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Steward',
        includeHistory: false,
        newContent: 'translated_widget.sessionMove',
      })
    );
  });

  it('appends a move summary when the model omits a comment', async () => {
    const { handler, ctx, toolCall, updateConversationNote } = createHandlerHarness('o');

    await handler.handle(ctx, { toolCall });

    expect(updateConversationNote).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Steward',
        includeHistory: false,
        newContent: 'translated_widget.sessionMove',
      })
    );
  });

  it('applies and advances when it is the actor turn', async () => {
    const { handler, ctx, toolCall, applyAction, recordMoveAndAdvance, serializeInvocation } =
      createHandlerHarness('o');

    await handler.handle(ctx, { toolCall });

    expect(applyAction).toHaveBeenCalledTimes(1);
    expect(recordMoveAndAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'o',
        action: 'playCell',
        params: { index: 0 },
        turnOrder: ['user', 'o'],
      })
    );
    const okResult = serializeInvocation.mock.calls[0][0].result;
    expect(okResult.type).toBe('json');
    expect(okResult.value).toEqual({ ok: true, message: expect.any(String) });
    expect(okResult.value).not.toHaveProperty('action');
    expect(okResult.value).not.toHaveProperty('comment');
  });

  it('rejects an out-of-turn move without applying when the roster already advanced', async () => {
    const { handler, ctx, toolCall, applyAction, recordMoveAndAdvance, serializeInvocation } =
      createHandlerHarness('user');

    await handler.handle(ctx, { toolCall });

    expect(applyAction).not.toHaveBeenCalled();
    expect(recordMoveAndAdvance).not.toHaveBeenCalled();
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ result: { type: 'error-text', value: 'not_your_turn' } })
    );
  });
});
