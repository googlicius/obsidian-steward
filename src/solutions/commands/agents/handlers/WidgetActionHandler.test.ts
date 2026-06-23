import { WidgetActionHandler, widgetActionSchema } from './WidgetActionHandler';
import type { WidgetActionArgs } from './WidgetActionHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { ToolCallPart } from '../../tools/types';
import { IntentResultStatus } from '../../types';
import { WidgetOrchestrator } from 'src/services/WidgetService/WidgetOrchestrator';

describe('widgetActionSchema', () => {
  it('accepts action, optional params and comment', () => {
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

  const definition = {
    actors: {
      turnOrder: ['user', 'o', 'x'],
      actors: { user: { kind: 'human' }, o: { kind: 'model' }, x: { kind: 'model' } },
    },
    actions: {
      name: 'actions',
      actions: {
        playCell: {},
        undo: { endTurn: false },
      },
    },
    agents: {
      o: { actions: ['playCell', 'undo'] },
      x: { actions: ['playCell', 'undo'] },
    },
  };

  function createHandlerHarness(currentActor: string, phase: 'thinking' | 'awaiting_input' = 'thinking') {
    const applyAction = jest.fn().mockResolvedValue({ ok: true });
    const recordMoveAndMaybeAdvance = jest.fn().mockResolvedValue(undefined);
    const updateConversationNote = jest.fn().mockResolvedValue(undefined);
    const serializeInvocation = jest.fn().mockResolvedValue(undefined);

    (WidgetOrchestrator as unknown as { instance: WidgetOrchestrator | null }).instance = null;
    const orchestrator = WidgetOrchestrator.getInstance({} as never);

    const getConversationProperty = jest
      .fn()
      .mockImplementation(async (_title: string, key: string) => {
        if (key === 'widget_project_path') {
          return projectPath;
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
              phase,
              moveLog: [],
            }),
          },
          sessionService: {
            recordMoveAndMaybeAdvance,
          },
          orchestrator,
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
      recordMoveAndMaybeAdvance,
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

  it('applies and advances when it is the actor turn with endTurn action', async () => {
    const { handler, ctx, toolCall, applyAction, recordMoveAndMaybeAdvance, serializeInvocation } =
      createHandlerHarness('o');

    const result = await handler.handle(ctx, { toolCall });

    expect(applyAction).toHaveBeenCalledTimes(1);
    expect(recordMoveAndMaybeAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'o',
        action: 'playCell',
        params: { index: 0 },
        turnOrder: ['user', 'o', 'x'],
        endTurn: true,
      })
    );
    const okResult = serializeInvocation.mock.calls[0][0].result;
    expect(okResult.type).toBe('json');
    expect(okResult.value).toEqual(
      expect.objectContaining({ ok: true, endTurn: true, message: expect.any(String) })
    );
    expect(result.status).toBe(IntentResultStatus.STOP_PROCESSING);
  });

  it('records move without advancing for endTurn false actions', async () => {
    const { handler, ctx, toolCall, recordMoveAndMaybeAdvance } = createHandlerHarness('o');

    const undoCall = {
      ...toolCall,
      input: { action: 'undo' },
    } as unknown as ToolCallPart<WidgetActionArgs>;

    const result = await handler.handle(ctx, { toolCall: undoCall });

    expect(recordMoveAndMaybeAdvance).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'o',
        action: 'undo',
        endTurn: false,
      })
    );
    expect(result.status).toBe(IntentResultStatus.SUCCESS);
  });

  it('rejects when session phase is not thinking', async () => {
    const { handler, ctx, toolCall, applyAction, serializeInvocation } = createHandlerHarness(
      'o',
      'awaiting_input'
    );

    await handler.handle(ctx, { toolCall });

    expect(applyAction).not.toHaveBeenCalled();
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ result: { type: 'error-text', value: 'not_your_turn' } })
    );
  });

  it('rejects an out-of-turn move without applying when the roster already advanced', async () => {
    const { handler, ctx, toolCall, applyAction, recordMoveAndMaybeAdvance, serializeInvocation } =
      createHandlerHarness('user', 'awaiting_input');

    await handler.handle(ctx, { toolCall });

    expect(applyAction).not.toHaveBeenCalled();
    expect(recordMoveAndMaybeAdvance).not.toHaveBeenCalled();
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ result: { type: 'error-text', value: 'not_your_turn' } })
    );
  });
});
