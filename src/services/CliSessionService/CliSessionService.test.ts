import type { ChildProcessWithoutNullStreams } from 'child_process';
import { loadNodeModule } from 'src/utils/loadNodeModule';
import {
  BUILT_IN_INTERACTIVE_APPS,
  CliSessionService,
  isInteractiveCliCommand,
  type CliSession,
} from './CliSessionService';
import { AbortOperationKeys } from 'src/constants';
import type StewardPlugin from 'src/main';

let isDesktopApp = true;

jest.mock('obsidian', () => {
  const actual = jest.requireActual<typeof import('obsidian')>('obsidian');
  return {
    ...actual,
    Platform: {
      get isDesktopApp() {
        return isDesktopApp;
      },
    },
  };
});

jest.mock('src/utils/loadNodeModule', () => ({
  loadNodeModule: jest.fn(),
}));

const SENTINEL = '__STEWARD_DONE__';

const loadNodeModuleMock = loadNodeModule as jest.MockedFunction<typeof loadNodeModule>;

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {} as unknown as jest.Mocked<StewardPlugin>;
}

function createPluginWithCliInteractivePrograms(
  interactivePrograms: string | undefined
): jest.Mocked<StewardPlugin> {
  return {
    ...createMockPlugin(),
    settings: {
      cli: {
        interactivePrograms,
      },
    } as unknown as StewardPlugin['settings'],
  } as unknown as jest.Mocked<StewardPlugin>;
}

/** Minimal plugin so {@link CliSessionService.endSession} can run (abort, decorations, async vault paths). */
function createPluginForEndSessionDefaults(): jest.Mocked<StewardPlugin> {
  const vaultProcess = jest.fn(async (_file: unknown, fn: (c: string) => string) => {
    fn('');
  });
  return {
    ...createMockPlugin(),
    abortService: { abortOperation: jest.fn() } as unknown as StewardPlugin['abortService'],
    commandInputService: {
      notifyCliSessionDecorationRefresh: jest.fn(),
    } as unknown as StewardPlugin['commandInputService'],
    conversationRenderer: {
      getConversationFileByName: jest
        .fn()
        .mockReturnValue({ path: 'Steward/Conversations/test-conv.md' }),
      getConversationProperty: jest.fn().mockResolvedValue(null),
    } as unknown as StewardPlugin['conversationRenderer'],
    wikilinkForwardService: {
      setForwardedTo: jest.fn().mockResolvedValue(undefined),
    } as unknown as StewardPlugin['wikilinkForwardService'],
    app: {
      vault: { process: vaultProcess },
      workspace: { getActiveFile: jest.fn().mockReturnValue(null) },
    } as unknown as StewardPlugin['app'],
    settings: { stewardFolder: 'Steward' } as unknown as StewardPlugin['settings'],
  } as unknown as jest.Mocked<StewardPlugin>;
}

function createSession(overrides: Partial<CliSession> = {}): CliSession {
  return {
    conversationTitle: 'test-conv',
    hostConversationTitle: 'test-conv',
    cliMode: 'transcript',
    child: { pid: 1 } as unknown as ChildProcessWithoutNullStreams,
    outputBuffer: '',
    flushTimer: null,
    operationId: 'op-1',
    pendingSentinelMarker: null,
    hideStreamMarkerNextFlush: false,
    cdCommandHistory: [],
    ...overrides,
  };
}

function registerSession(service: CliSessionService, session: CliSession): void {
  const sessions = service['sessions'] as Map<string, CliSession>;
  sessions.set(session.conversationTitle, session);
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>(resolve => {
    setImmediate(resolve);
  });
}

function createPluginForLifecycle(): {
  plugin: jest.Mocked<StewardPlugin>;
  noteContentRef: { value: string };
  abortOperation: jest.Mock;
  notifyRefresh: jest.Mock;
  getConversationFileByName: jest.Mock;
  vaultProcess: jest.Mock;
  getActiveFile: jest.Mock;
} {
  const noteContentRef = { value: '' };
  const abortOperation = jest.fn();
  const notifyRefresh = jest.fn();
  const getConversationFileByName = jest.fn();
  const vaultProcess = jest.fn();
  const getActiveFile = jest.fn();

  getConversationFileByName.mockImplementation(() => ({
    path: 'Steward/Conversations/test-conv.md',
  }));
  vaultProcess.mockImplementation(async (_file: unknown, fn: (c: string) => string) => {
    noteContentRef.value = fn(noteContentRef.value);
  });

  const plugin = {
    ...createMockPlugin(),
    abortService: { abortOperation } as unknown as StewardPlugin['abortService'],
    commandInputService: {
      notifyCliSessionDecorationRefresh: notifyRefresh,
    } as unknown as StewardPlugin['commandInputService'],
    conversationRenderer: {
      getConversationFileByName,
    } as unknown as StewardPlugin['conversationRenderer'],
    wikilinkForwardService: {
      setForwardedTo: jest.fn().mockResolvedValue(undefined),
    } as unknown as StewardPlugin['wikilinkForwardService'],
    app: {
      vault: {
        process: vaultProcess,
      },
      workspace: {
        getActiveFile,
      },
    } as unknown as StewardPlugin['app'],
    settings: {
      stewardFolder: 'Steward',
    } as unknown as StewardPlugin['settings'],
  } as unknown as jest.Mocked<StewardPlugin>;

  return {
    plugin,
    noteContentRef,
    abortOperation,
    notifyRefresh,
    getConversationFileByName,
    vaultProcess,
    getActiveFile,
  };
}

describe('CliSessionService', () => {
  let service: CliSessionService;
  let stripSentinelMarker: (chunk: string) => { stripped: boolean; content: string };
  let appendOutput: (conversationTitle: string, chunk: string, isStderr: boolean) => void;

  beforeEach(() => {
    isDesktopApp = true;
    loadNodeModuleMock.mockReset();
    service = new CliSessionService(createMockPlugin());
    stripSentinelMarker = service['stripSentinelMarker'].bind(service);
    appendOutput = service['appendOutput'].bind(service);
    jest
      .spyOn(service as unknown as { scheduleFlush: () => void }, 'scheduleFlush')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('stripSentinelMarker', () => {
    it('removes only lines that contain the sentinel and keeps the rest', () => {
      const chunk = `line one\nline two\necho ${SENTINEL}\nnoise after\nmore`;
      expect(stripSentinelMarker(chunk)).toEqual({
        stripped: true,
        content: 'line one\nline two\nnoise after\nmore',
      });
    });

    it('returns the chunk unchanged when the sentinel is absent', () => {
      const chunk = `line one\nline two\n`;
      expect(stripSentinelMarker(chunk)).toEqual({
        stripped: false,
        content: chunk,
      });
    });

    it('removes the sentinel line but keeps following lines', () => {
      const chunk = `${SENTINEL}\nrest`;
      expect(stripSentinelMarker(chunk)).toEqual({
        stripped: true,
        content: 'rest',
      });
    });
  });

  describe('appendOutput', () => {
    const expectBufferHasNoSentinel = (session: CliSession): void => {
      expect(session.outputBuffer).not.toContain(SENTINEL);
    };

    it('with pending sentinel: strips marker lines from chunk and clears pending; buffer has no sentinel', () => {
      const session = createSession({
        pendingSentinelMarker: SENTINEL,
        outputBuffer: '',
      });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `hello\nworld\necho ${SENTINEL}\nafter\n`, false);
      expect(session.pendingSentinelMarker).toBeNull();
      expect(session.outputBuffer).toBe('hello\nworld\nafter\n');
      expect(session.hideStreamMarkerNextFlush).toBe(true);
      expectBufferHasNoSentinel(session);
    });

    it('with pending sentinel and empty buffer: only sentinel in chunk yields placeholder; no sentinel in buffer', () => {
      const session = createSession({
        pendingSentinelMarker: SENTINEL,
        outputBuffer: '',
      });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `echo ${SENTINEL}\n`, false);
      expect(session.outputBuffer).toBe('(No output)\n');
      expect(session.hideStreamMarkerNextFlush).toBe(true);
      expectBufferHasNoSentinel(session);
    });

    it('with pending sentinel and non-empty buffer: sentinel-only chunk keeps prior buffer; no sentinel', () => {
      const session = createSession({
        pendingSentinelMarker: SENTINEL,
        outputBuffer: 'already here\n',
      });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `${SENTINEL}\n`, false);
      expect(session.outputBuffer).toBe('already here\n');
      expect(session.hideStreamMarkerNextFlush).toBe(true);
      expectBufferHasNoSentinel(session);
    });

    it('without pending: stderr chunk with sentinel is prefixed and stripped; no sentinel in buffer', () => {
      const session = createSession({ pendingSentinelMarker: null });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `err\n${SENTINEL}\n`, true);
      expect(session.outputBuffer).toBe('[stderr] err\n');
      expect(session.hideStreamMarkerNextFlush).toBe(true);
      expectBufferHasNoSentinel(session);
    });

    it('without pending: stdout chunk with sentinel only removes marker lines', () => {
      const session = createSession({ pendingSentinelMarker: null, outputBuffer: 'x\n' });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `out\n${SENTINEL}\ntail\n`, false);
      expect(session.outputBuffer).toBe('x\nout\ntail\n');
      expect(session.hideStreamMarkerNextFlush).toBe(true);
      expectBufferHasNoSentinel(session);
    });
  });

  describe('updateStreamMarkerInNote', () => {
    it('can replace active stream markers with hidden placeholders', async () => {
      const lifecycle = createPluginForLifecycle();
      service = new CliSessionService(lifecycle.plugin);
      lifecycle.noteContentRef.value = 'before <!--stw-cli-stream--> after';
      const updateStreamMarkerInNote = service['updateStreamMarkerInNote'].bind(
        service
      ) as (params: { conversationTitle: string; action: 'remove' | 'hide' }) => Promise<void>;
      await updateStreamMarkerInNote({
        conversationTitle: 'test-conv',
        action: 'hide',
      });
      await flushMicrotasks();

      expect(lifecycle.noteContentRef.value).toContain('<!--stw-cli-stream-hide-->');
      expect(lifecycle.noteContentRef.value).not.toContain('<!--stw-cli-stream-->');
    });
  });

  describe('interruptSession', () => {
    let interruptService: CliSessionService;

    beforeEach(() => {
      isDesktopApp = true;
      loadNodeModuleMock.mockResolvedValue({});
      interruptService = new CliSessionService(createMockPlugin());
    });

    it('returns immediately on non-desktop without loading child_process', async () => {
      isDesktopApp = false;
      const session = createSession({
        child: { pid: 42 } as unknown as ChildProcessWithoutNullStreams,
      });
      await interruptService.interruptSession(session);
      expect(loadNodeModuleMock).not.toHaveBeenCalled();
    });

    it('calls remoteKill when session.remoteKill is set', async () => {
      const remoteKill = jest.fn();
      const session = createSession({
        child: { pid: 99 } as unknown as ChildProcessWithoutNullStreams,
        remoteKill,
      });
      await interruptService.interruptSession(session);
      expect(remoteKill).toHaveBeenCalledTimes(1);
      expect(loadNodeModuleMock).not.toHaveBeenCalled();
    });

    const describeOnUnix = process.platform === 'win32' ? describe.skip : describe;
    describeOnUnix('on Unix', () => {
      it("calls process.kill(-pid, 'SIGINT') when no remoteKill", async () => {
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
        const session = createSession({
          child: { pid: 4242 } as unknown as ChildProcessWithoutNullStreams,
        });
        await interruptService.interruptSession(session);
        expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGINT');
        killSpy.mockRestore();
      });
    });

    const describeOnWindows = process.platform === 'win32' ? describe : describe.skip;
    describeOnWindows('on Windows', () => {
      it('uses taskkill /f /t when no remoteKill', async () => {
        const spawnMock = jest.fn();
        loadNodeModuleMock.mockResolvedValue({ spawn: spawnMock });
        const session = createSession({
          child: { pid: 777 } as unknown as ChildProcessWithoutNullStreams,
        });
        await interruptService.interruptSession(session);
        expect(spawnMock).toHaveBeenCalledWith(
          'taskkill',
          ['/pid', '777', '/f', '/t'],
          expect.objectContaining({ shell: true, windowsHide: true })
        );
      });
    });
  });

  describe('endSession', () => {
    let interruptSessionSpy: jest.SpyInstance;

    beforeEach(() => {
      isDesktopApp = true;
      service = new CliSessionService(createPluginForEndSessionDefaults());
      jest
        .spyOn(service as unknown as { scheduleFlush: () => void }, 'scheduleFlush')
        .mockImplementation(() => {});
      interruptSessionSpy = jest
        .spyOn(CliSessionService.prototype, 'interruptSession')
        .mockResolvedValue(undefined as void);
    });

    afterEach(() => {
      interruptSessionSpy.mockRestore();
    });

    describe('process killing (interruptSession)', () => {
      it('calls interruptSession when killProcess is true', () => {
        const session = createSession();
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle, killProcess: true });
        expect(interruptSessionSpy).toHaveBeenCalledTimes(1);
        expect(interruptSessionSpy).toHaveBeenCalledWith(session);
      });

      it('calls interruptSession when killProcess is omitted', () => {
        const session = createSession();
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        expect(interruptSessionSpy).toHaveBeenCalledTimes(1);
      });

      it('skips interruptSession when killProcess is explicitly false', () => {
        const session = createSession();
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle, killProcess: false });
        expect(interruptSessionSpy).not.toHaveBeenCalled();
      });
    });

    describe('markXtermAsForwardedToHost (async)', () => {
      let lifecycle: ReturnType<typeof createPluginForLifecycle>;
      let getHostTitleSpy: jest.SpyInstance;
      let setForwardedToMock: jest.Mock;

      beforeEach(() => {
        lifecycle = createPluginForLifecycle();
        service = new CliSessionService(lifecycle.plugin);
        jest
          .spyOn(service as unknown as { scheduleFlush: () => void }, 'scheduleFlush')
          .mockImplementation(() => {});
        getHostTitleSpy = jest.spyOn(service, 'getCliXtermHostConversationTitle');
        setForwardedToMock = lifecycle.plugin.wikilinkForwardService
          .setForwardedTo as unknown as jest.Mock;
      });

      it('does not call setForwardedTo when getCliXtermHostConversationTitle returns null', async () => {
        getHostTitleSpy.mockResolvedValue(null);
        const session = createSession({ conversationTitle: 'cli_xterm__Host' });
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(setForwardedToMock).not.toHaveBeenCalled();
      });

      it('declares the xterm conversation as forwarded to its host', async () => {
        const xtermTitle = 'cli_xterm__MyHost';
        const hostTitle = 'MyHost';
        getHostTitleSpy.mockResolvedValue(hostTitle);
        const session = createSession({ conversationTitle: xtermTitle });
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(setForwardedToMock).toHaveBeenCalledTimes(1);
        expect(setForwardedToMock).toHaveBeenCalledWith({
          sourceConversationTitle: xtermTitle,
          targetConversationTitle: hostTitle,
        });
      });
    });

    describe('updateStreamMarkerInNote via endSession (async)', () => {
      let lifecycle: ReturnType<typeof createPluginForLifecycle>;

      beforeEach(() => {
        lifecycle = createPluginForLifecycle();
        service = new CliSessionService(lifecycle.plugin);
        jest
          .spyOn(service as unknown as { scheduleFlush: () => void }, 'scheduleFlush')
          .mockImplementation(() => {});
        jest.spyOn(service, 'getCliXtermHostConversationTitle').mockResolvedValue(null);
      });

      it('removes the stream marker string from the note content when present', async () => {
        const marker = '<!--stw-cli-stream-->';
        lifecycle.noteContentRef.value = `a${marker}b`;
        const session = createSession();
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(lifecycle.noteContentRef.value).toBe('ab');
        expect(lifecycle.vaultProcess).toHaveBeenCalled();
      });

      it('leaves note content unchanged when the marker is absent', async () => {
        lifecycle.noteContentRef.value = 'plain note';
        const session = createSession();
        registerSession(service, session);
        lifecycle.vaultProcess.mockClear();
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(lifecycle.noteContentRef.value).toBe('plain note');
        expect(lifecycle.vaultProcess).toHaveBeenCalled();
      });
    });

    it('clears session, aborts operation, and refreshes decorations', () => {
      const lifecycle = createPluginForLifecycle();
      service = new CliSessionService(lifecycle.plugin);
      jest
        .spyOn(service as unknown as { scheduleFlush: () => void }, 'scheduleFlush')
        .mockImplementation(() => {});
      jest.spyOn(service, 'getCliXtermHostConversationTitle').mockResolvedValue(null);

      const session = createSession();
      registerSession(service, session);
      service.endSession({ conversationTitle: session.conversationTitle });

      expect(lifecycle.abortOperation).toHaveBeenCalledWith(
        session.conversationTitle,
        AbortOperationKeys.CLI_SESSION
      );
      expect(lifecycle.notifyRefresh).toHaveBeenCalled();
      expect(service.getSession(session.conversationTitle)).toBeUndefined();
    });
  });

  describe('recordCdCommandsFromQuery', () => {
    it('does nothing when no session exists for the given title', () => {
      expect(() => {
        service.recordCdCommandsFromQuery({
          conversationTitle: 'nonexistent',
          argsLine: 'cd /foo',
        });
      }).not.toThrow();
    });

    it('leaves cdCommandHistory unchanged when argsLine is empty', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: '',
      });
      expect(session.cdCommandHistory).toEqual([]);
    });

    it('leaves cdCommandHistory unchanged when argsLine has no cd commands', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'ls -la && echo hello',
      });
      expect(session.cdCommandHistory).toEqual([]);
    });

    it('ignores segments where "cd" is a prefix of another word (e.g. cdstuff)', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cdstuff /foo',
      });
      expect(session.cdCommandHistory).toEqual([]);
    });

    it('appends a single cd command to an empty history', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /home/user',
      });
      expect(session.cdCommandHistory).toEqual(['cd /home/user']);
    });

    it('appends a bare cd with no path', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd',
      });
      expect(session.cdCommandHistory).toEqual(['cd']);
    });

    it('appends cd commands split by &&', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /foo && echo done',
      });
      expect(session.cdCommandHistory).toEqual(['cd /foo']);
    });

    it('appends cd commands split by ||', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /foo || echo fail',
      });
      expect(session.cdCommandHistory).toEqual(['cd /foo']);
    });

    it('appends multiple cd commands split by ;', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /foo; cd /bar',
      });
      expect(session.cdCommandHistory).toEqual(['cd /foo', 'cd /bar']);
    });

    it('appends multiple cd commands split by newline', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /foo\ncd /bar',
      });
      expect(session.cdCommandHistory).toEqual(['cd /foo', 'cd /bar']);
    });

    it('appends multiple cd commands split by \\r\\n', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /foo\r\ncd /bar',
      });
      expect(session.cdCommandHistory).toEqual(['cd /foo', 'cd /bar']);
    });

    it('is case-insensitive when matching cd', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'CD /foo && Cd /bar',
      });
      expect(session.cdCommandHistory).toEqual(['CD /foo', 'Cd /bar']);
    });

    it('extracts only cd segments from a mixed compound argsLine', () => {
      const session = createSession({ cdCommandHistory: [] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'ls && cd /proj && echo hi; cd /tmp',
      });
      expect(session.cdCommandHistory).toEqual(['cd /proj', 'cd /tmp']);
    });

    it('appends to existing history entries', () => {
      const session = createSession({ cdCommandHistory: ['cd /existing'] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /new',
      });
      expect(session.cdCommandHistory).toEqual(['cd /existing', 'cd /new']);
    });

    it('caps cdCommandHistory at 200 entries keeping the most recent', () => {
      const initial = Array.from({ length: 200 }, (_, i) => `cd /dir-${i}`);
      const session = createSession({ cdCommandHistory: [...initial] });
      registerSession(service, session);
      service.recordCdCommandsFromQuery({
        conversationTitle: session.conversationTitle,
        argsLine: 'cd /overflow-1; cd /overflow-2',
      });
      expect(session.cdCommandHistory).toHaveLength(200);
      expect(session.cdCommandHistory.at(-1)).toBe('cd /overflow-2');
      expect(session.cdCommandHistory.at(-2)).toBe('cd /overflow-1');
      expect(session.cdCommandHistory[0]).toBe('cd /dir-2');
    });
  });

  describe('isInteractiveCliCommand', () => {
    it('is true when a later line starts with a supported app (e.g. cd then vim)', () => {
      expect(
        isInteractiveCliCommand('cd Archived\nvim Welcome.md', BUILT_IN_INTERACTIVE_APPS)
      ).toBe(true);
    });

    it('is true when a later && segment starts with a supported app', () => {
      expect(isInteractiveCliCommand('cd /tmp && nvim file.txt', BUILT_IN_INTERACTIVE_APPS)).toBe(
        true
      );
    });

    it('is false when no line or chain segment starts with a supported app', () => {
      expect(isInteractiveCliCommand('cd Archived\necho done', BUILT_IN_INTERACTIVE_APPS)).toBe(
        false
      );
    });
  });

  describe('getSupportedInteractiveApps', () => {
    it('returns built-in apps when interactivePrograms is empty', () => {
      const svc = new CliSessionService(createPluginWithCliInteractivePrograms(''));
      expect(svc.getSupportedInteractiveApps()).toEqual([...BUILT_IN_INTERACTIVE_APPS]);
    });

    it('treats undefined interactivePrograms like empty string', () => {
      const svc = new CliSessionService(createPluginWithCliInteractivePrograms(undefined));
      expect(svc.getSupportedInteractiveApps()).toEqual([...BUILT_IN_INTERACTIVE_APPS]);
    });

    it('merges comma-separated custom entries (lower-cased, trimmed) after built-ins', () => {
      const svc = new CliSessionService(
        createPluginWithCliInteractivePrograms(' Emacs ,  rustup ')
      );
      expect(svc.getSupportedInteractiveApps()).toEqual([
        ...BUILT_IN_INTERACTIVE_APPS,
        'emacs',
        'rustup',
      ]);
    });

    it('splits on newlines as well as commas', () => {
      const svc = new CliSessionService(createPluginWithCliInteractivePrograms('foo\nbar,baz'));
      expect(svc.getSupportedInteractiveApps()).toEqual([
        ...BUILT_IN_INTERACTIVE_APPS,
        'foo',
        'bar',
        'baz',
      ]);
    });

    it('dedupes repeats in config and overlaps with built-ins', () => {
      const svc = new CliSessionService(createPluginWithCliInteractivePrograms('vim, VIM ,nano'));
      const list = svc.getSupportedInteractiveApps();
      expect(list.filter(a => a === 'vim')).toHaveLength(1);
      expect(list.filter(a => a === 'nano')).toHaveLength(1);
      expect(list).toEqual([...BUILT_IN_INTERACTIVE_APPS]);
    });

    it('appends new unique apps in first-seen order', () => {
      const svc = new CliSessionService(createPluginWithCliInteractivePrograms('zed\ncursor\nzed'));
      expect(svc.getSupportedInteractiveApps()).toEqual([
        ...BUILT_IN_INTERACTIVE_APPS,
        'zed',
        'cursor',
      ]);
    });
  });
});
