import type { ChildProcessWithoutNullStreams } from 'child_process';
import { loadNodeModule } from 'src/utils/loadNodeModule';
import { CliSessionService, type CliSession } from './CliSessionService';
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
      getConversationFileByName: jest.fn().mockReturnValue({ path: 'Steward/Conversations/test-conv.md' }),
      getConversationProperty: jest.fn().mockResolvedValue(null),
    } as unknown as StewardPlugin['conversationRenderer'],
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
    streamMarker: '<!-- stream -->',
    outputBuffer: '',
    flushTimer: null,
    operationId: 'op-1',
    pendingSentinelMarker: null,
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

/** StewardPlugin types `editor` as a read-only getter; plain test doubles need a defined property. */
function attachTestEditorToPlugin(
  plugin: jest.Mocked<StewardPlugin>,
  editor: { getValue: () => string; setValue: jest.Mock }
): void {
  Object.defineProperty(plugin, 'editor', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: editor,
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

  getConversationFileByName.mockImplementation(() => ({ path: 'Steward/Conversations/test-conv.md' }));
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
  let stripSentinelMarker: (chunk: string) => string;
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
      expect(stripSentinelMarker(chunk)).toBe('line one\nline two\nnoise after\nmore');
    });

    it('returns the chunk unchanged when the sentinel is absent', () => {
      const chunk = `line one\nline two\n`;
      expect(stripSentinelMarker(chunk)).toBe(chunk);
    });

    it('removes the sentinel line but keeps following lines', () => {
      const chunk = `${SENTINEL}\nrest`;
      expect(stripSentinelMarker(chunk)).toBe('rest');
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
      expectBufferHasNoSentinel(session);
    });

    it('without pending: stderr chunk with sentinel is prefixed and stripped; no sentinel in buffer', () => {
      const session = createSession({ pendingSentinelMarker: null });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `err\n${SENTINEL}\n`, true);
      expect(session.outputBuffer).toBe('[stderr] err\n');
      expectBufferHasNoSentinel(session);
    });

    it('without pending: stdout chunk with sentinel only removes marker lines', () => {
      const session = createSession({ pendingSentinelMarker: null, outputBuffer: 'x\n' });
      registerSession(service, session);
      appendOutput(session.conversationTitle, `out\n${SENTINEL}\ntail\n`, false);
      expect(session.outputBuffer).toBe('x\nout\ntail\n');
      expectBufferHasNoSentinel(session);
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
      const session = createSession({ child: { pid: 42 } as unknown as ChildProcessWithoutNullStreams });
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

    describe('restoreHostConversationEmbedIfNeeded (async)', () => {
      let lifecycle: ReturnType<typeof createPluginForLifecycle>;
      let getHostTitleSpy: jest.SpyInstance;

      beforeEach(() => {
        lifecycle = createPluginForLifecycle();
        service = new CliSessionService(lifecycle.plugin);
        jest
          .spyOn(service as unknown as { scheduleFlush: () => void }, 'scheduleFlush')
          .mockImplementation(() => {});
        getHostTitleSpy = jest.spyOn(service, 'getCliXtermHostConversationTitle');
      });

      it('skips restore when getCliXtermHostConversationTitle returns null', async () => {
        const setValue = jest.fn();
        attachTestEditorToPlugin(lifecycle.plugin, {
          getValue: () => '![[Steward/Conversations/cli_xterm__Host]]',
          setValue,
        });
        getHostTitleSpy.mockResolvedValue(null);
        const session = createSession({ conversationTitle: 'cli_xterm__Host' });
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(setValue).not.toHaveBeenCalled();
      });

      it('updates the active editor content when the embed pattern matches', async () => {
        const xtermTitle = 'cli_xterm__MyHost';
        const hostTitle = 'MyHost';
        const before = `intro\n![[Steward/Conversations/${xtermTitle}]]\n/ tail`;
        const setValue = jest.fn();
        attachTestEditorToPlugin(lifecycle.plugin, {
          getValue: () => before,
          setValue,
        });
        getHostTitleSpy.mockResolvedValue(hostTitle);
        const session = createSession({ conversationTitle: xtermTitle });
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(setValue).toHaveBeenCalledTimes(1);
        expect(setValue).toHaveBeenCalledWith(
          `intro\n![[Steward/Conversations/${hostTitle}]]\n/ tail`
        );
      });
    });

    describe('removeStreamMarkerFromNote (async)', () => {
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
        const session = createSession({ streamMarker: marker });
        registerSession(service, session);
        service.endSession({ conversationTitle: session.conversationTitle });
        await flushMicrotasks();
        expect(lifecycle.noteContentRef.value).toBe('ab');
        expect(lifecycle.vaultProcess).toHaveBeenCalled();
      });

      it('leaves note content unchanged when the marker is absent', async () => {
        const marker = '<!--stw-cli-stream-->';
        lifecycle.noteContentRef.value = 'plain note';
        const session = createSession({ streamMarker: marker });
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

      expect(lifecycle.abortOperation).toHaveBeenCalledWith(session.operationId);
      expect(lifecycle.notifyRefresh).toHaveBeenCalled();
      expect(service.getSession(session.conversationTitle)).toBeUndefined();
    });
  });
});
