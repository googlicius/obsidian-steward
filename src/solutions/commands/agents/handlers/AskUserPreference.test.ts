import { AskUserPreference } from './AskUserPreference';
import { IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';

describe('AskUserPreference', () => {
  it('writes waiting output and shows preference buttons', async () => {
    const serializeToolInvocation = jest.fn().mockResolvedValue('msg-pref-1');
    const showPreferenceButtons = jest.fn().mockResolvedValue(undefined);

    const agent = {
      renderer: {
        serializeToolInvocation,
        showPreferenceButtons,
      },
    };

    const ctx = {
      title: 'Chat',
      handlerId: 'handler-1',
      step: 0,
      lang: 'en',
      agentHandlerParams: { title: 'Chat', intent: { type: ' ', query: 'test' } },
      agent,
    };

    const handler = new AskUserPreference(agent as never);
    const result = await handler.handle(ctx as never, {
      toolCall: {
        toolName: ToolName.ASK_USER_PREFERENCE,
        toolCallId: 'call-pref-1',
        type: 'tool-call',
        input: {
          questions: [{ question: 'Which format?', options: ['Markdown', 'Plain text'] }],
        },
      },
    });

    expect(result.status).toBe(IntentResultStatus.STOP_PROCESSING);
    expect(serializeToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'Chat',
        command: ToolName.ASK_USER_PREFERENCE,
        toolInvocations: [
          expect.objectContaining({
            toolCallId: 'call-pref-1',
            type: 'tool-result',
            output: { type: 'text', value: 'Q1: waiting_for_user_answer' },
          }),
        ],
      })
    );
    expect(showPreferenceButtons).toHaveBeenCalledWith({
      conversationTitle: 'Chat',
      messageId: 'msg-pref-1',
    });
  });

  it('builds a per-question placeholder for each question, in order', async () => {
    const serializeToolInvocation = jest.fn().mockResolvedValue('msg-pref-2');
    const showPreferenceButtons = jest.fn().mockResolvedValue(undefined);

    const agent = {
      renderer: {
        serializeToolInvocation,
        showPreferenceButtons,
      },
    };

    const ctx = {
      title: 'Chat',
      handlerId: 'handler-1',
      step: 0,
      lang: 'en',
      agentHandlerParams: { title: 'Chat', intent: { type: ' ', query: 'test' } },
      agent,
    };

    const handler = new AskUserPreference(agent as never);
    const result = await handler.handle(ctx as never, {
      toolCall: {
        toolName: ToolName.ASK_USER_PREFERENCE,
        toolCallId: 'call-pref-2',
        type: 'tool-call',
        input: {
          questions: [
            { question: 'Which format?', options: ['Markdown', 'Plain text'] },
            { question: 'Which scope?', options: ['Whole vault', 'Current note'] },
          ],
        },
      },
    });

    expect(result.status).toBe(IntentResultStatus.STOP_PROCESSING);
    expect(serializeToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolInvocations: [
          expect.objectContaining({
            output: {
              type: 'text',
              value: 'Q1: waiting_for_user_answer\nQ2: waiting_for_user_answer',
            },
          }),
        ],
      })
    );
  });

  it('rejects a question with fewer than 2 options', async () => {
    const agent = { renderer: {} };
    const ctx = { title: 'Chat', lang: 'en' };

    const handler = new AskUserPreference(agent as never);
    const result = await handler.handle(ctx as never, {
      toolCall: {
        toolName: ToolName.ASK_USER_PREFERENCE,
        toolCallId: 'call-pref-3',
        type: 'tool-call',
        input: {
          questions: [{ question: 'Which format?', options: ['Markdown'] }],
        },
      },
    });

    expect(result.status).toBe(IntentResultStatus.ERROR);
  });
});
