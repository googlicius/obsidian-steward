import { BUILT_IN_INTERACTIVE_APPS } from 'src/services/CliSessionService/CliSessionService';
import {
  CliHandler,
  isShellCommandAllowedWithoutConfirmation,
  type ShellToolInput,
} from './CliHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import { IntentResultStatus } from '../../types';
import { MANUAL_TOOL_CALL_ID_PREFIX } from 'src/constants';
import type { AgentHandlerParams, Intent } from '../../types';
import { HandlerInvocationContext } from '../HandlerInvocationContext';
import { createTestHandlerInvocationContext } from './testUtils';

function createMockAgent(): jest.Mocked<AgentHandlerContext> {
  return {
    app: {} as AgentHandlerContext['app'],
    obsidianAPITools: {} as AgentHandlerContext['obsidianAPITools'],
    renderer: {
      updateConversationNote: jest.fn().mockResolvedValue(undefined),
      serializeToolInvocation: jest.fn().mockResolvedValue(undefined),
    },
    plugin: {
      cliSessionService: {
        endSession: jest.fn(),
        getSupportedInteractiveApps: jest.fn().mockReturnValue([...BUILT_IN_INTERACTIVE_APPS]),
      },
    },
    commandProcessor: {
      deleteNextPendingIntent: jest.fn(),
    },
    deleteTempStreamFile: jest.fn(),
  } as unknown as jest.Mocked<AgentHandlerContext>;
}

function createShellToolCall(toolCallId: string, argsLine: string): ToolCallPart<ShellToolInput> {
  return {
    type: 'tool-call',
    toolCallId,
    toolName: ToolName.SHELL,
    input: { argsLine },
  } as ToolCallPart<ShellToolInput>;
}

function baseParams(title: string, intent?: Intent): AgentHandlerParams {
  return {
    title,
    intent: intent ?? ({ type: 'test', query: '' } as Intent),
    handlerId: 'handler-1',
    invocationCount: 0,
  };
}

describe('CliHandler', () => {
  describe('handle', () => {
    let mockAgent: jest.Mocked<AgentHandlerContext>;
    let handler: CliHandler;

    function createCtx(title: string, intent?: Intent): HandlerInvocationContext {
      return createTestHandlerInvocationContext({
        agent: mockAgent,
        agentHandlerParams: baseParams(title, intent),
      });
    }

    beforeEach(() => {
      mockAgent = createMockAgent();
      handler = new CliHandler(mockAgent);
    });

    it('runs the shell session immediately when the tool call is client-made (manual prefix)', async () => {
      const runShellSessionSpy = jest
        .spyOn(
          handler as unknown as { runShellSession: CliHandler['runShellSession'] },
          'runShellSession'
        )
        .mockResolvedValue({ messageId: 'msg-manual' });

      const result = await handler.handle(createCtx('Conv-A'), {
        toolCall: createShellToolCall(`${MANUAL_TOOL_CALL_ID_PREFIX}id-1`, 'echo hi'),
      });

      expect(runShellSessionSpy).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(IntentResultStatus.SUCCESS);
      expect(mockAgent.renderer.updateConversationNote).not.toHaveBeenCalled();

      runShellSessionSpy.mockRestore();
    });

    it('requires confirmation when the shell tool call is not client-made', async () => {
      const result = await handler.handle(createCtx('Conv-B'), {
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
        .spyOn(
          handler as unknown as { runShellSession: CliHandler['runShellSession'] },
          'runShellSession'
        )
        .mockResolvedValue({ messageId: 'msg-ai' });

      const result = await handler.handle(createCtx('Conv-C'), {
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

    it('skips confirmation when intent allowlist matches and command is non-interactive', async () => {
      const runShellSessionSpy = jest
        .spyOn(
          handler as unknown as { runShellSession: CliHandler['runShellSession'] },
          'runShellSession'
        )
        .mockResolvedValue({ messageId: 'auto' });
      const continueFromNext = jest.fn().mockResolvedValue({ status: IntentResultStatus.SUCCESS });

      const result = await handler.handle(
        createCtx('Conv-D', {
          type: 'test',
          query: '',
          cli: { whitelist: ['echo*'] },
        }),
        {
          toolCall: createShellToolCall('model-auto-1', 'echo hi'),
          continueFromNextTool: continueFromNext,
        }
      );

      expect(result.status).toBe(IntentResultStatus.SUCCESS);
      expect(mockAgent.renderer.updateConversationNote).not.toHaveBeenCalled();
      expect(runShellSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Conv-D' } as HandlerInvocationContext),
        expect.anything(),
        true
      );
      expect(continueFromNext).toHaveBeenCalled();
      expect(mockAgent.renderer.serializeToolInvocation).toHaveBeenCalled();
      expect(mockAgent.plugin.cliSessionService.endSession).toHaveBeenCalledWith({
        conversationTitle: 'Conv-D',
        killProcess: true,
      });

      runShellSessionSpy.mockRestore();
    });

    it('still requires confirmation when allowlist matches but command is interactive', async () => {
      const result = await handler.handle(
        createCtx('Conv-E', {
          type: 'test',
          query: '',
          cli: { whitelist: ['vim*'] },
        }),
        {
          toolCall: createShellToolCall('model-int-1', 'vim'),
        }
      );

      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);
      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalled();
    });
  });
});

describe('isShellCommandAllowedWithoutConfirmation', () => {
  it('matches exact pattern', () => {
    expect(isShellCommandAllowedWithoutConfirmation('ls', ['ls'])).toBe(true);
    expect(isShellCommandAllowedWithoutConfirmation('ls -la', ['ls'])).toBe(false);
  });

  it('matches prefix when pattern ends with *', () => {
    expect(isShellCommandAllowedWithoutConfirmation('Get-Content foo', ['Get-Content*'])).toBe(
      true
    );
    expect(isShellCommandAllowedWithoutConfirmation('echo hi', ['echo*'])).toBe(true);
  });

  it('returns false for empty args or empty patterns', () => {
    expect(isShellCommandAllowedWithoutConfirmation('', ['ls'])).toBe(false);
    expect(isShellCommandAllowedWithoutConfirmation('   ', ['ls'])).toBe(false);
    expect(isShellCommandAllowedWithoutConfirmation('ls', [])).toBe(false);
  });
});
