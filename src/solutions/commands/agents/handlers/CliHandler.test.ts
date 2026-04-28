import { CliHandler, type ShellToolInput } from './CliHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import { IntentResultStatus } from '../../types';
import { MANUAL_TOOL_CALL_ID_PREFIX } from 'src/constants';
import type { Intent } from '../../types';

function createMockAgent(): jest.Mocked<AgentHandlerContext> {
  return {
    app: {} as AgentHandlerContext['app'],
    obsidianAPITools: {} as AgentHandlerContext['obsidianAPITools'],
    renderer: {
      updateConversationNote: jest.fn().mockResolvedValue(undefined),
    },
    plugin: {
      cliSessionService: {
        endSession: jest.fn(),
      },
    },
    commandProcessor: {
      deleteNextPendingIntent: jest.fn(),
    },
    serializeInvocation: jest.fn().mockResolvedValue(undefined),
    deleteTempStreamFile: jest.fn(),
  } as unknown as jest.Mocked<AgentHandlerContext>;
}

function createShellToolCall(
  toolCallId: string,
  argsLine: string
): ToolCallPart<ShellToolInput> {
  return {
    type: 'tool-call',
    toolCallId,
    toolName: ToolName.SHELL,
    input: { argsLine },
  } as ToolCallPart<ShellToolInput>;
}

function baseParams(title: string): {
  title: string;
  intent: Intent;
  handlerId: string;
  invocationCount: number;
} {
  return {
    title,
    intent: { type: 'test', query: '' } as Intent,
    handlerId: 'handler-1',
    invocationCount: 0,
  };
}

describe('CliHandler', () => {
  describe('handle', () => {
    let mockAgent: jest.Mocked<AgentHandlerContext>;
    let handler: CliHandler;

    beforeEach(() => {
      mockAgent = createMockAgent();
      handler = new CliHandler(mockAgent);
    });

    it('runs the shell session immediately when the tool call is client-made (manual prefix)', async () => {
      const runShellSessionSpy = jest
        .spyOn(handler as unknown as { runShellSession: CliHandler['runShellSession'] }, 'runShellSession')
        .mockResolvedValue({ messageId: 'msg-manual' });

      const result = await handler.handle(baseParams('Conv-A'), {
        toolCall: createShellToolCall(`${MANUAL_TOOL_CALL_ID_PREFIX}id-1`, 'echo hi'),
      });

      expect(runShellSessionSpy).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(IntentResultStatus.SUCCESS);
      expect(mockAgent.renderer.updateConversationNote).not.toHaveBeenCalled();

      runShellSessionSpy.mockRestore();
    });

    it('requires confirmation when the shell tool call is not client-made', async () => {
      const result = await handler.handle(baseParams('Conv-B'), {
        toolCall: createShellToolCall('model-tool-call-99', 'rm -rf /'),
      });

      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);
      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Conv-B',
          command: ToolName.SHELL,
        })
      );
    });

    it('after confirmation, tears down the transcript session for model runs (endSession)', async () => {
      const runShellSessionSpy = jest
        .spyOn(handler as unknown as { runShellSession: CliHandler['runShellSession'] }, 'runShellSession')
        .mockResolvedValue({ messageId: 'msg-ai' });

      const result = await handler.handle(baseParams('Conv-C'), {
        toolCall: createShellToolCall('model-tool-call-confirm', 'ls'),
      });

      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);
      if (result.status !== IntentResultStatus.NEEDS_CONFIRMATION) {
        throw new Error('expected NEEDS_CONFIRMATION');
      }

      await result.onConfirmation('yes');

      expect(runShellSessionSpy).toHaveBeenCalled();
      expect(mockAgent.plugin.cliSessionService.endSession).toHaveBeenCalledWith({
        conversationTitle: 'Conv-C',
        killProcess: true,
      });

      runShellSessionSpy.mockRestore();
    });
  });
});
