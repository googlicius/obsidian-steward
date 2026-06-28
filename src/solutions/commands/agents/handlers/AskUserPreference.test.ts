import { AskUserPreference } from './AskUserPreference';
import { IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';

describe('AskUserPreference', () => {
  it('writes question, waiting output, and preference buttons', async () => {
    const updateConversationNote = jest.fn().mockResolvedValue(undefined);
    const serializeToolInvocation = jest.fn().mockResolvedValue('msg-pref-1');
    const showPreferenceButtons = jest.fn().mockResolvedValue(undefined);

    const agent = {
      renderer: {
        updateConversationNote,
        serializeToolInvocation,
        showPreferenceButtons,
      },
    };

    const ctx = {
      title: 'Chat',
      handlerId: 'handler-1',
      step: 0,
      lang: 'en',
      updateConversationNote,
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
          question: 'Which format?',
          options: ['Markdown', 'Plain text'],
        },
      },
    });

    expect(result.status).toBe(IntentResultStatus.STOP_PROCESSING);
    expect(updateConversationNote).toHaveBeenCalledWith({
      newContent: 'Which format?',
      includeHistory: false,
    });
    expect(serializeToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'Chat',
        command: ToolName.ASK_USER_PREFERENCE,
        toolInvocations: [
          expect.objectContaining({
            toolCallId: 'call-pref-1',
            type: 'tool-result',
            output: { type: 'text', value: 'waiting_for_user_answer' },
          }),
        ],
      })
    );
    expect(showPreferenceButtons).toHaveBeenCalledWith({
      conversationTitle: 'Chat',
      messageId: 'msg-pref-1',
    });
  });
});
