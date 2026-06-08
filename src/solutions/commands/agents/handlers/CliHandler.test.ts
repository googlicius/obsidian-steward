import { BUILT_IN_INTERACTIVE_APPS } from 'src/services/CliSessionService/CliSessionService';
import { CliHandler, isShellCommandAllowed, type ShellToolInput } from './CliHandler';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import { IntentResultStatus } from '../../types';
import { MANUAL_TOOL_CALL_ID_PREFIX } from 'src/constants';
import type { AgentHandlerParams, Intent } from '../../types';
import { HandlerInvocationContext } from '../HandlerInvocationContext';
import { createTestHandlerInvocationContext } from './testUtils';
import {
  NODE_PTY_INSTALLER_PS1_BASENAME,
  NODE_PTY_INSTALLER_SH_BASENAME,
} from 'src/constants/nodePtyInstallerConstants';

jest.mock('obsidian', () => {
  const actual = jest.requireActual<typeof import('obsidian')>('obsidian');
  return {
    ...actual,
    Platform: {
      isDesktopApp: true,
      isMobileApp: false,
    },
    normalizePath: (path: string) => path.replace(/\\/g, '/'),
  };
});

function createMockAgent(): jest.Mocked<AgentHandlerContext> {
  return {
    app: {} as AgentHandlerContext['app'],
    obsidianAPITools: {} as AgentHandlerContext['obsidianAPITools'],
    renderer: {
      updateConversationNote: jest.fn().mockResolvedValue(undefined),
      serializeToolInvocation: jest.fn().mockResolvedValue(undefined),
      getConversationProperty: jest.fn().mockResolvedValue(undefined),
    },
    plugin: {
      settings: {
        stewardFolder: 'Steward',
      },
      cliSessionService: {
        endSession: jest.fn(),
        getSupportedInteractiveApps: jest.fn().mockReturnValue([...BUILT_IN_INTERACTIVE_APPS]),
        getCliXtermHostConversationTitle: jest.fn().mockResolvedValue(null),
        getCliXtermNoteTitleForHost: jest
          .fn()
          .mockImplementation((hostTitle: string) => `cli_interactive_${hostTitle}`),
        startShellProcess: jest.fn().mockResolvedValue({ ok: true }),
        getSession: jest.fn().mockReturnValue(undefined),
        resolveWorkingDirectoryFromTranscriptCdHistory: jest.fn().mockResolvedValue(undefined),
      },
      userDefinedCommandService: {
        getCommandCli: jest.fn().mockReturnValue(undefined),
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

      mockAgent.renderer.getConversationProperty = jest
        .fn()
        .mockImplementation(async (_title: string, property: string) => {
          if (property === 'udc_command') {
            return 'test-cmd';
          }
          return undefined;
        });
      mockAgent.plugin.userDefinedCommandService.getCommandCli = jest
        .fn()
        .mockReturnValue({ whitelist: ['echo*'] });

      const result = await handler.handle(createCtx('Conv-D'), {
        toolCall: createShellToolCall('model-auto-1', 'echo hi'),
        continueFromNextTool: continueFromNext,
      });

      expect(result.status).toBe(IntentResultStatus.SUCCESS);
      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Conv-D',
          newContent: '\n```shell\necho hi\n```',
          role: 'Steward',
          includeHistory: false,
        })
      );
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

    it('includes purpose in confirmation message for model shell calls', async () => {
      const result = await handler.handle(createCtx('Conv-F'), {
        toolCall: {
          ...createShellToolCall('model-purpose-1', 'npm install'),
          input: {
            argsLine: 'npm install',
            purpose: 'I will install the project dependencies.',
            lang: 'en',
          },
        },
      });

      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);
      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Conv-F',
          newContent: expect.stringContaining(
            '# I will install the project dependencies.\nnpm install'
          ),
          includeHistory: false,
        })
      );
    });

    it('shows purpose before auto-approved shell commands', async () => {
      const runShellSessionSpy = jest
        .spyOn(
          handler as unknown as { runShellSession: CliHandler['runShellSession'] },
          'runShellSession'
        )
        .mockResolvedValue({ messageId: 'auto-purpose' });

      mockAgent.renderer.getConversationProperty = jest
        .fn()
        .mockImplementation(async (_title: string, property: string) => {
          if (property === 'udc_command') {
            return 'test-cmd';
          }
          return undefined;
        });
      mockAgent.plugin.userDefinedCommandService.getCommandCli = jest
        .fn()
        .mockReturnValue({ whitelist: ['echo*'] });

      await handler.handle(createCtx('Conv-G'), {
        toolCall: {
          ...createShellToolCall('model-auto-purpose', 'echo hi'),
          input: {
            argsLine: 'echo hi',
            purpose: 'I will print a greeting to the shell output.',
            lang: 'en',
          },
        },
      });

      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Conv-G',
          newContent: '\n```shell\n# I will print a greeting to the shell output.\necho hi\n```',
          role: 'Steward',
          includeHistory: false,
        })
      );

      runShellSessionSpy.mockRestore();
    });

    it('still requires confirmation when allowlist matches but command is interactive', async () => {
      mockAgent.renderer.getConversationProperty = jest
        .fn()
        .mockImplementation(async (_title: string, property: string) => {
          if (property === 'udc_command') {
            return 'test-cmd';
          }
          return undefined;
        });
      mockAgent.plugin.userDefinedCommandService.getCommandCli = jest
        .fn()
        .mockReturnValue({ whitelist: ['vim*'] });

      const result = await handler.handle(createCtx('Conv-E'), {
        toolCall: createShellToolCall('model-int-1', 'vim'),
      });

      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);
      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalled();
    });
  });

  describe('runShellSession spawn failure', () => {
    let mockAgent: jest.Mocked<AgentHandlerContext>;
    let handler: CliHandler;

    function createCtx(title: string): HandlerInvocationContext {
      return createTestHandlerInvocationContext({
        agent: mockAgent,
        agentHandlerParams: baseParams(title),
      });
    }

    beforeEach(() => {
      mockAgent = createMockAgent();
      handler = new CliHandler(mockAgent);
      mockAgent.renderer.updateConversationNote = jest.fn().mockResolvedValue('err-msg-id');
    });

    it('writes node-pty install instructions to the host note when heuristic interactive spawn fails', async () => {
      mockAgent.plugin.cliSessionService.startShellProcess = jest.fn().mockResolvedValue({
        ok: false,
        errorMessage: 'The node-pty native bundle folder is missing',
      });

      const waitSpy = jest
        .spyOn(
          handler as unknown as { waitForShellOutputFlushed: () => Promise<void> },
          'waitForShellOutputFlushed'
        )
        .mockResolvedValue(undefined);

      await handler.handle(createCtx('2026-06-01_01-48-48'), {
        toolCall: createShellToolCall(`${MANUAL_TOOL_CALL_ID_PREFIX}manual-vim`, 'vim'),
      });

      expect(mockAgent.plugin.cliSessionService.startShellProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationTitle: 'cli_interactive_2026-06-01_01-48-48',
          initialArgsLine: 'vim',
        })
      );
      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '2026-06-01_01-48-48',
          command: 'cli',
          newContent: expect.stringMatching(
            new RegExp(
              `${NODE_PTY_INSTALLER_PS1_BASENAME}[\\s\\S]*${NODE_PTY_INSTALLER_SH_BASENAME}`
            )
          ),
        })
      );
      expect(waitSpy).not.toHaveBeenCalled();

      waitSpy.mockRestore();
    });

    it('writes node-pty install instructions when needsInteractiveMode is explicitly true', async () => {
      mockAgent.plugin.cliSessionService.startShellProcess = jest.fn().mockResolvedValue({
        ok: false,
        errorMessage: 'PTY companion unavailable',
      });

      await handler.handle(createCtx('Host-Note'), {
        toolCall: {
          ...createShellToolCall(`${MANUAL_TOOL_CALL_ID_PREFIX}manual-empty`, ''),
          input: { argsLine: '', needsInteractiveMode: true },
        },
      });

      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Host-Note',
          newContent: expect.stringContaining(NODE_PTY_INSTALLER_PS1_BASENAME),
        })
      );
    });

    it('writes plain spawn error for non-interactive transcript spawn failure', async () => {
      const spawnError = 'CliSessionService failed to load child_process.';
      mockAgent.plugin.cliSessionService.startShellProcess = jest.fn().mockResolvedValue({
        ok: false,
        errorMessage: spawnError,
      });

      const waitSpy = jest
        .spyOn(
          handler as unknown as { waitForShellOutputFlushed: () => Promise<void> },
          'waitForShellOutputFlushed'
        )
        .mockResolvedValue(undefined);

      await handler.handle(createCtx('Transcript-Host'), {
        toolCall: createShellToolCall(`${MANUAL_TOOL_CALL_ID_PREFIX}manual-echo`, 'echo hi'),
      });

      expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'Transcript-Host',
          newContent: spawnError,
        })
      );
      expect(waitSpy).toHaveBeenCalledWith({
        conversationTitle: 'Transcript-Host',
        messageId: 'err-msg-id',
      });

      waitSpy.mockRestore();
    });
  });
});

describe('buildShellCommandFence', () => {
  let handler: CliHandler;
  let buildShellCommandFence: CliHandler['buildShellCommandFence'];

  beforeEach(() => {
    handler = new CliHandler(createMockAgent());
    buildShellCommandFence = handler['buildShellCommandFence'].bind(handler);
  });

  it('returns empty string when there is no purpose or command', () => {
    expect(buildShellCommandFence({ argsLine: '' })).toBe('');
    expect(buildShellCommandFence({ argsLine: '   ', purpose: '  ' })).toBe('');
  });

  it('builds a fence with a leading newline and optional purpose comment', () => {
    expect(buildShellCommandFence({ argsLine: 'pwd' })).toBe('\n```shell\npwd\n```');
    expect(
      buildShellCommandFence({
        argsLine: 'npm install',
        purpose: 'Install dependencies.',
      })
    ).toBe('\n```shell\n# Install dependencies.\nnpm install\n```');
  });
});

describe('isShellCommandAllowed', () => {
  it('matches exact pattern', () => {
    expect(isShellCommandAllowed('ls', ['ls'])).toBe(true);
    expect(isShellCommandAllowed('ls -la', ['ls'])).toBe(false);
  });

  it('matches prefix when pattern ends with *', () => {
    expect(isShellCommandAllowed('Get-Content foo', ['Get-Content*'])).toBe(true);
    expect(isShellCommandAllowed('echo hi', ['echo*'])).toBe(true);
  });

  it('matches glob patterns with * in the middle or at both ends', () => {
    expect(
      isShellCommandAllowed('rm -f _temp_transcript.en.srt', ['rm *_temp_transcript.en.srt'])
    ).toBe(true);
    expect(isShellCommandAllowed('rm "_temp_transcript.en.srt"', ['rm *_temp_transcript*'])).toBe(
      true
    );
    expect(isShellCommandAllowed('cat _temp_transcript.en.srt', ['*_temp_transcript.en.srt'])).toBe(
      true
    );
    expect(isShellCommandAllowed('echo hi', ['*hi*'])).toBe(true);
    expect(isShellCommandAllowed('echo hi', ['*bye*'])).toBe(false);
  });

  it('escapes regex metacharacters outside glob wildcards', () => {
    expect(isShellCommandAllowed('grep (foo)', ['grep (foo)'])).toBe(true);
    expect(isShellCommandAllowed('grep foo.bar', ['grep foo.bar'])).toBe(true);
    expect(isShellCommandAllowed('grep fooXbar', ['grep foo.bar'])).toBe(false);
  });

  it('returns false for empty args or empty patterns', () => {
    expect(isShellCommandAllowed('', ['ls'])).toBe(false);
    expect(isShellCommandAllowed('   ', ['ls'])).toBe(false);
    expect(isShellCommandAllowed('ls', [])).toBe(false);
  });
});
