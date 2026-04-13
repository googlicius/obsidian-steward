import type { ChildProcessWithoutNullStreams } from 'child_process';
import { CliSessionService, type CliSession } from './CliSessionService';
import type StewardPlugin from 'src/main';

const SENTINEL = '__STEWARD_DONE__';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {} as unknown as jest.Mocked<StewardPlugin>;
}

function createSession(overrides: Partial<CliSession> = {}): CliSession {
  return {
    conversationTitle: 'test-conv',
    child: { pid: 1 } as unknown as ChildProcessWithoutNullStreams,
    streamMarker: '<!-- stream -->',
    outputBuffer: '',
    flushTimer: null,
    operationId: '',
    pendingSentinelMarker: null,
    ...overrides,
  };
}

function registerSession(service: CliSessionService, session: CliSession): void {
  const sessions = service['sessions'] as Map<string, CliSession>;
  sessions.set(session.conversationTitle, session);
}

describe('CliSessionService', () => {
  let service: CliSessionService;
  let stripSentinelMarker: (chunk: string) => string;
  let appendOutput: (conversationTitle: string, chunk: string, isStderr: boolean) => void;

  beforeEach(() => {
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
});
