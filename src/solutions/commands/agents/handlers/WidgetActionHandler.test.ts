import { WidgetActionHandler, widgetActionSchema } from './WidgetActionHandler';
import type { WidgetActionArgs } from './WidgetActionHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { ToolCallPart } from '../../tools/types';

describe('widgetActionSchema', () => {
  it('accepts omitted with_json and with_presentation as enabled defaults', () => {
    const result = widgetActionSchema.safeParse({
      action: 'playCell',
      params: { index: 0 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.with_json).toBeUndefined();
      expect(result.data.with_presentation).toBeUndefined();
    }
  });

  it('rejects when both views are disabled', () => {
    const result = widgetActionSchema.safeParse({
      action: 'playCell',
      with_json: false,
      with_presentation: false,
    });

    expect(result.success).toBe(false);
  });

  it('allows disabling only json for the next turn', () => {
    const result = widgetActionSchema.safeParse({
      action: 'playCell',
      with_json: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.with_json).toBe(false);
      expect(result.data.with_presentation).toBeUndefined();
    }
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
    const recordModelMoveAndAdvance = jest.fn().mockResolvedValue(undefined);
    const appendMoveComment = jest.fn().mockResolvedValue(undefined);
    const updateTurnContextPrefs = jest.fn().mockResolvedValue(undefined);
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
            recordModelMoveAndAdvance,
            appendMoveComment,
            updateTurnContextPrefs,
          },
          applyAction,
        },
      },
    } as unknown as AgentHandlerContext;

    const handler = new WidgetActionHandler(agent);
    const ctx = {
      agentHandlerParams: { title: 'tic-tac-toe__session_live' },
      serializeInvocation,
    } as unknown as HandlerInvocationContext;

    const toolCall = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'widget_action',
      input: { action: 'playCell', params: { index: 0 } },
    } as unknown as ToolCallPart<WidgetActionArgs>;

    return { handler, ctx, toolCall, applyAction, recordModelMoveAndAdvance, serializeInvocation };
  }

  it('applies and advances when it is the actor turn', async () => {
    const { handler, ctx, toolCall, applyAction, recordModelMoveAndAdvance, serializeInvocation } =
      createHandlerHarness('o');

    await handler.handle(ctx, { toolCall });

    expect(applyAction).toHaveBeenCalledTimes(1);
    expect(recordModelMoveAndAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'o', action: 'playCell', turnOrder: ['user', 'o'] })
    );
    const okResult = serializeInvocation.mock.calls[0][0].result;
    expect(okResult.type).toBe('json');
    expect(okResult.value).toEqual({ ok: true, message: expect.any(String) });
    expect(okResult.value).not.toHaveProperty('action');
    expect(okResult.value).not.toHaveProperty('comment');
  });

  it('rejects an out-of-turn move without applying when the roster already advanced', async () => {
    const { handler, ctx, toolCall, applyAction, recordModelMoveAndAdvance, serializeInvocation } =
      createHandlerHarness('user');

    await handler.handle(ctx, { toolCall });

    expect(applyAction).not.toHaveBeenCalled();
    expect(recordModelMoveAndAdvance).not.toHaveBeenCalled();
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ result: { type: 'error-text', value: 'not_your_turn' } })
    );
  });
});
