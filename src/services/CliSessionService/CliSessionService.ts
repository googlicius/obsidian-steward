import { FileSystemAdapter, Platform } from 'obsidian';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { loadNodeModule } from 'src/utils/loadNodeModule';
import i18next from 'i18next';
import stripAnsi from 'strip-ansi';
import {
  createRemotePtySession,
  type RemotePtyChildShim,
} from 'src/solutions/pty-companion/client';

const SENTINEL_MARKER = `__STEWARD_DONE__`;

const isWin = process.platform === 'win32';

export type CliSessionMode = 'transcript' | 'interactive';

/** Simple routing: interactive (node-pty) when the command line starts with any supported app (trimmed, case-insensitive). */
export function isInteractiveCliCommand(argsLine: string): boolean {
  const trimmed = argsLine.trimStart().toLowerCase();
  const supportedInteractiveApps = ['vim', 'gemini'];
  return supportedInteractiveApps.filter(app => trimmed.startsWith(app)).length > 0;
}

export interface CliSession {
  conversationTitle: string;
  /** Transcript uses child_process + sentinel; interactive uses remote PTY (vim, …). */
  cliMode: CliSessionMode;
  child: ChildProcessWithoutNullStreams | RemotePtyChildShim;
  streamMarker: string;
  outputBuffer: string;
  flushTimer: number | null;
  operationId: string;
  pendingSentinelMarker: string | null; // marker we're waiting for
  /** When set, {@link interruptSession} forwards to the PTY companion instead of OS signals. */
  remoteKill?: () => void;
}

function sanitizeFenceContent(text: string): string {
  return text.replace(/```/g, '`\u200b`\u200b`');
}

/** PTY and rich shells emit CSI/SGR escapes; notes are plain text — strip for readability. */
function normalizeCliOutputForNote(text: string): string {
  const plain = stripAnsi(text);
  return plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export class CliSessionService {
  private sessions: Map<string, CliSession> = new Map();

  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Removes every line that contains the done sentinel (e.g. `echo __STEWARD_DONE__` noise).
   * Other lines and their order are preserved.
   */
  private stripSentinelMarker(chunk: string): string {
    if (!chunk.includes(SENTINEL_MARKER)) {
      return chunk;
    }
    return chunk
      .split(/\r?\n/)
      .filter(line => !line.includes(SENTINEL_MARKER))
      .join('\n');
  }

  private refreshCommandInputDecorations(): void {
    this.plugin.commandInputService.notifyCliSessionDecorationRefresh();
  }

  private async writeBufferedCliOutput(params: {
    conversationTitle: string;
    streamMarker: string;
    text: string;
  }): Promise<void> {
    const file = this.plugin.conversationRenderer.getConversationFileByName(
      params.conversationTitle
    );
    await this.plugin.app.vault.process(file, content => {
      if (!content.includes(params.streamMarker)) {
        return content;
      }
      return content.replace(params.streamMarker, `${params.text}${params.streamMarker}`);
    });
  }

  private async removeStreamMarkerFromNote(params: {
    conversationTitle: string;
    streamMarker: string;
  }): Promise<void> {
    try {
      const file = this.plugin.conversationRenderer.getConversationFileByName(
        params.conversationTitle
      );
      await this.plugin.app.vault.process(file, content => {
        if (!content.includes(params.streamMarker)) {
          return content;
        }
        return content.replace(params.streamMarker, '');
      });
    } catch (error) {
      logger.error('CliSessionService removeStreamMarker failed:', error);
    }
  }

  public getSession(conversationTitle: string): CliSession | undefined {
    return this.sessions.get(conversationTitle);
  }

  public cancelFlushTimer(session: CliSession): void {
    if (session.flushTimer !== null) {
      window.clearTimeout(session.flushTimer);
      session.flushTimer = null;
    }
  }

  public disposeAll(): void {
    const titles = Array.from(this.sessions.keys());
    for (let i = 0; i < titles.length; i++) {
      this.endSession({ conversationTitle: titles[i], killProcess: true });
    }
  }

  private buildShellSpawnConfig(): { file: string; args: string[] } | null {
    const configured = this.plugin.settings.cli.shellExecutable.trim();
    const shell = configured !== '' ? configured : isWin ? 'powershell.exe' : '/bin/bash';
    return { file: shell, args: [] };
  }

  private resolveWorkingDirectory(): string {
    const configured = this.plugin.settings.cli.workingDirectory.trim();
    if (configured !== '') {
      return configured;
    }
    const adapter = this.plugin.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return '';
  }

  /** Env for spawned shells: discourage color/CSI when writing output into Markdown. */
  private cliChildEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      TERM: 'dumb',
      NO_COLOR: '1',
    };
  }

  /** Env for PTY-backed interactive shells (actual TTY semantics). */
  private cliInteractiveChildEnv(): NodeJS.ProcessEnv {
    const base = { ...process.env };
    delete base.NO_COLOR;
    return {
      ...base,
      TERM: 'xterm-256color',
    };
  }

  public async flushOutputForConversation(
    conversationTitle: string,
    force: boolean
  ): Promise<void> {
    const session = this.sessions.get(conversationTitle);
    if (!session) {
      return;
    }
    await this.flushOutput(session, force);
  }

  public async interruptSession(session: CliSession): Promise<void> {
    if (!Platform.isDesktopApp) {
      return;
    }
    if (session.remoteKill) {
      session.remoteKill();
      return;
    }
    if (!session.child.pid) {
      logger.warn('No such process');
      return;
    }

    const cp = await loadNodeModule('child_process').catch(error => {
      logger.error('CliSessionService interruptSession failed to load child_process:', error);
    });

    if (!cp) return;

    try {
      if (isWin) {
        cp.spawn('taskkill', ['/pid', String(session.child.pid), '/f', '/t'], {
          shell: true,
          windowsHide: true,
        });
      } else {
        process.kill(-session.child.pid, 'SIGINT');
      }
    } catch (error) {
      logger.error('CliSessionService interruptSession failed:', error);
    }
  }

  /**
   * Spawn a shell for {@link conversationTitle} and register stdout/stderr listeners.
   */
  public async startShellProcess(params: {
    conversationTitle: string;
    streamMarker: string;
    /** Used to choose PTY vs child_process on first spawn (empty → transcript). */
    initialArgsLine?: string;
  }): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
    if (!Platform.isDesktopApp) {
      return { ok: false, errorMessage: i18next.t('cli.desktopOnly') };
    }

    const cwd = this.resolveWorkingDirectory();

    const spawnConfig = this.buildShellSpawnConfig();
    if (!spawnConfig) {
      return { ok: false, errorMessage: 'no shell configuration' };
    }

    const initialLine = params.initialArgsLine ?? '';
    const useInteractivePty = isInteractiveCliCommand(initialLine);
    const companion = useInteractivePty
      ? this.plugin.ptyCompanionService.getConnectionParams()
      : null;

    if (useInteractivePty) {
      if (!companion) {
        return {
          ok: false,
          errorMessage:
            'Interactive commands (e.g. vim) need the PTY companion running with node-pty available.',
        };
      }

      let child: RemotePtyChildShim;
      let remoteKill: () => void;
      try {
        const created = await createRemotePtySession({
          connection: companion,
          spawn: {
            file: spawnConfig.file,
            args: spawnConfig.args,
            cwd,
            env: this.cliInteractiveChildEnv(),
          },
        });
        child = created.child;
        remoteKill = created.remoteKill;
      } catch (error) {
        logger.error('CliSessionService remote PTY spawn failed:', error);
        return { ok: false, errorMessage: String(error) };
      }

      const session: CliSession = {
        conversationTitle: params.conversationTitle,
        cliMode: 'interactive',
        child,
        streamMarker: params.streamMarker,
        outputBuffer: '',
        flushTimer: null,
        operationId: '',
        pendingSentinelMarker: null,
        remoteKill,
      };
      this.sessions.set(params.conversationTitle, session);
      this.refreshCommandInputDecorations();

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        this.appendOutput(params.conversationTitle, chunk, false);
      });
      child.stderr.on('data', (chunk: string) => {
        this.appendOutput(params.conversationTitle, chunk, true);
      });
      child.on('error', err => {
        logger.error('CliSessionService child error:', err);
        this.appendOutput(params.conversationTitle, `\n[error] ${String(err)}\n`, true);
      });

      child.on('close', (code, signal) => {
        const current = this.sessions.get(params.conversationTitle);
        if (!current || current.child !== child) {
          return;
        }
        const exitNote =
          signal !== null
            ? i18next.t('cli.processEndedSignal', { signal: String(signal) })
            : i18next.t('cli.processEndedCode', { code: String(code) });
        this.appendOutput(params.conversationTitle, `\n${exitNote}\n`, false);
        void this.flushOutput(current, true).then(() => {
          this.endSession({ conversationTitle: params.conversationTitle, killProcess: false });
        });
      });

      return { ok: true };
    }

    const cp = await loadNodeModule('child_process').catch(error => {
      logger.error('CliSessionService failed to load child_process:', error);
    });

    if (!cp) {
      return { ok: false, errorMessage: 'CliSessionService failed to load child_process.' };
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = cp.spawn(spawnConfig.file, spawnConfig.args, {
        cwd,
        env: this.cliChildEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: true,
        detached: !isWin,
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      logger.error('CliSessionService spawn failed:', error);
      return { ok: false, errorMessage: String(error) };
    }

    const session: CliSession = {
      conversationTitle: params.conversationTitle,
      cliMode: 'transcript',
      child,
      streamMarker: params.streamMarker,
      outputBuffer: '',
      flushTimer: null,
      operationId: '',
      pendingSentinelMarker: null,
    };
    this.sessions.set(params.conversationTitle, session);
    this.refreshCommandInputDecorations();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      this.appendOutput(params.conversationTitle, chunk, false);
    });
    child.stderr.on('data', (chunk: string) => {
      this.appendOutput(params.conversationTitle, chunk, true);
    });
    child.on('error', err => {
      logger.error('CliSessionService child error:', err);
      this.appendOutput(params.conversationTitle, `\n[error] ${String(err)}\n`, true);
    });

    child.on('close', (code, signal) => {
      const current = this.sessions.get(params.conversationTitle);
      if (!current || current.child !== child) {
        return;
      }
      const exitNote =
        signal !== null
          ? i18next.t('cli.processEndedSignal', { signal: String(signal) })
          : i18next.t('cli.processEndedCode', { code: String(code) });
      this.appendOutput(params.conversationTitle, `\n${exitNote}\n`, false);
      void this.flushOutput(current, true).then(() => {
        this.endSession({ conversationTitle: params.conversationTitle, killProcess: false });
      });
    });

    return { ok: true };
  }

  /**
   * @param killProcess - When false, the child has already exited (e.g. natural close).
   */
  public endSession(params: { conversationTitle: string; killProcess?: boolean }): void {
    const session = this.sessions.get(params.conversationTitle);
    if (!session) {
      return;
    }
    if (session.flushTimer !== null) {
      window.clearTimeout(session.flushTimer);
    }
    const streamMarker = session.streamMarker;
    const shouldKill = params.killProcess !== false;
    if (shouldKill) {
      void this.interruptSession(session);
    }
    this.plugin.abortService.abortOperation(session.operationId);
    this.sessions.delete(params.conversationTitle);
    this.refreshCommandInputDecorations();
    void this.removeStreamMarkerFromNote({
      conversationTitle: params.conversationTitle,
      streamMarker,
    });
  }

  public appendSentinelMarker(session: CliSession, argsLine: string) {
    if (session.cliMode === 'interactive') {
      session.child.stdin.write(`${argsLine}\n`);
      return;
    }

    session.pendingSentinelMarker = SENTINEL_MARKER;

    // Write the real command, then immediately echo the sentinel
    session.child.stdin.write(`${argsLine}\necho ${SENTINEL_MARKER}\n`);
  }

  private appendOutput(conversationTitle: string, chunk: string, isStderr: boolean): void {
    const session = this.sessions.get(conversationTitle);
    if (!session) {
      logger.warn('CLI session not found');
      return;
    }

    const stripped = this.stripSentinelMarker(chunk);

    // Check for and strip the sentinel line
    if (session.pendingSentinelMarker && chunk.includes(SENTINEL_MARKER)) {
      session.pendingSentinelMarker = null;

      // If there was real content in this chunk before the sentinel, handle it normally
      if (stripped.trim()) {
        session.outputBuffer += stripped;
      }

      // No output at all before the sentinel → inject the placeholder
      if (!session.outputBuffer) {
        session.outputBuffer += '(No output)\n';
      }
    } else {
      const prefix = isStderr ? '[stderr] ' : '';
      session.outputBuffer += `${prefix}${stripped}`;
    }

    this.scheduleFlush(session);
  }

  private scheduleFlush(session: CliSession): void {
    if (session.flushTimer !== null) {
      window.clearTimeout(session.flushTimer);
    }
    session.flushTimer = window.setTimeout(() => {
      session.flushTimer = null;
      void this.flushOutput(session, false);
    }, 100);
  }

  private async flushOutput(session: CliSession, force: boolean): Promise<void> {
    if (!force && session.outputBuffer === '') {
      return;
    }
    const toWrite = session.outputBuffer;
    session.outputBuffer = '';
    const marker = session.streamMarker;
    const safe = sanitizeFenceContent(normalizeCliOutputForNote(toWrite));
    try {
      await this.writeBufferedCliOutput({
        conversationTitle: session.conversationTitle,
        streamMarker: marker,
        text: safe,
      });
    } catch (error) {
      logger.error('CliSessionService flush failed:', error);
    }
  }
}
