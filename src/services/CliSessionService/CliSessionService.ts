import { FileSystemAdapter, Platform } from 'obsidian';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { loadNodeModule } from 'src/utils/loadNodeModule';
import i18next from 'i18next';
import { dump as yamlDump } from 'js-yaml';
import { getBundledLib } from 'src/utils/bundledLibs';
import {
  createRemotePtySession,
  type RemotePtyChildShim,
} from 'src/solutions/pty-companion/client';
import { resolveVaultPtyNativePath } from 'src/solutions/pty-companion/resolveVaultPtyNativePath';
import { CLI_STREAM_MARKER, CLI_XTERM_MARKER, getCliStreamMarkerPlaceholder } from './constants';

const SENTINEL_MARKER = `__STEWARD_DONE__`;
const PWD_START = '__STEWARD_PWD_START__';
const PWD_END = '__STEWARD_PWD_END__';

const CLI_NOTE_PREFIX = 'cli_interactive';

function isWindows(): boolean {
  if (typeof process === 'undefined') {
    return false;
  }
  return process.platform === 'win32';
}

export const BUILT_IN_INTERACTIVE_APPS = [
  'vim',
  'nvim',
  'nano',
  'htop',
  'gemini',
  'claude',
  'qwen',
  'hermes',
  'obsidian',
];

export type CliSessionMode = 'transcript' | 'interactive';

const SHELL_CHAIN_SPLIT = /&&|\|\||;/;

function firstSegmentTokenMatchesInteractiveApp(
  segment: string,
  supportedInteractiveApps: string[]
): boolean {
  const trimmed = segment.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const firstToken = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (firstToken.length === 0) {
    return false;
  }

  const normalizedToken = firstToken.endsWith('.exe') ? firstToken.slice(0, -4) : firstToken;

  for (let i = 0; i < supportedInteractiveApps.length; i++) {
    const app = supportedInteractiveApps[i].trim().toLowerCase();
    if (app.length === 0) {
      continue;
    }
    if (normalizedToken === app || firstToken === app) {
      return true;
    }
  }

  return false;
}

/**
 * Interactive (node-pty) when any line, or any `&&` / `||` / `;` chain segment on a line, starts
 * with a supported app (first token, case-insensitive, optional `.exe` strip on Windows).
 */
export function isInteractiveCliCommand(
  argsLine: string,
  supportedInteractiveApps = BUILT_IN_INTERACTIVE_APPS
): boolean {
  const trimmed = argsLine.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const lines = trimmed.split(/\r?\n/);
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l].trim();
    if (line.length === 0) {
      continue;
    }

    const segments = line.split(SHELL_CHAIN_SPLIT);
    for (let s = 0; s < segments.length; s++) {
      if (firstSegmentTokenMatchesInteractiveApp(segments[s], supportedInteractiveApps)) {
        return true;
      }
    }
  }

  return false;
}

export interface CliSession {
  conversationTitle: string;
  hostConversationTitle: string;
  /** Transcript uses child_process + sentinel; interactive uses remote PTY (vim, …). */
  cliMode: CliSessionMode;
  child: ChildProcessWithoutNullStreams | RemotePtyChildShim;
  outputBuffer: string;
  flushTimer: number | null;
  operationId: string;
  pendingSentinelMarker: string | null;
  hideStreamMarkerNextFlush: boolean;
  /** Ordered transcript `cd` commands used to reconstruct cwd when switching to interactive PTY. */
  cdCommandHistory: string[];
  /** When set, {@link interruptSession} forwards to the PTY companion instead of OS signals. */
  remoteKill?: () => void;
  /**
   * Interactive-only: last xterm buffer snapshot when the embed is torn down.
   * Omitted for transcript sessions.
   */
  xtermSnapshot?: {
    serializedState: string;
    cols: number;
    rows: number;
  };
}

function sanitizeFenceContent(text: string): string {
  return text.replace(/```/g, '`\u200b`\u200b`');
}

export class CliSessionService {
  private sessions: Map<string, CliSession> = new Map();

  constructor(private readonly plugin: StewardPlugin) {}

  private refreshCommandInputDecorations(): void {
    this.plugin.commandInputService.notifyCliSessionDecorationRefresh();
  }

  /** PTY and rich shells emit CSI/SGR escapes; notes are plain text — strip for readability. */
  private async normalizeCliOutputForNote(text: string): Promise<string> {
    const stripAnsi = await getBundledLib('stripAnsi');
    const plain = stripAnsi(text);
    return plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  private async updateStreamMarkerInNote(params: {
    conversationTitle: string;
    action: 'remove' | 'hide';
  }): Promise<void> {
    try {
      const file = this.plugin.conversationRenderer.getConversationFileByName(
        params.conversationTitle
      );
      await this.plugin.app.vault.process(file, content => {
        const streamMarkerRegex = new RegExp(CLI_STREAM_MARKER, 'g');
        if (!streamMarkerRegex.test(content)) {
          return content;
        }
        if (params.action === 'hide') {
          return content.replace(
            streamMarkerRegex,
            getCliStreamMarkerPlaceholder({ hidden: true })
          );
        }
        return content.replace(streamMarkerRegex, '');
      });
    } catch (error) {
      logger.error('CliSessionService updateStreamMarkerInNote failed:', error);
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

  public appendInfoTextToTranscript(conversationTitle: string, text: string): void {
    const normalized = text.trim();
    if (normalized.length === 0) {
      return;
    }
    this.appendOutput(conversationTitle, `${normalized}\n`, false);
  }

  public getSupportedInteractiveApps(): string[] {
    const configured = this.plugin.settings.cli.interactivePrograms ?? '';
    const dynamicPrograms = configured
      .toLowerCase()
      .split(/[,\n]/)
      .map(app => app.trim())
      .filter(app => app.length > 0);

    const unique = new Set<string>(BUILT_IN_INTERACTIVE_APPS);
    for (let i = 0; i < dynamicPrograms.length; i++) {
      unique.add(dynamicPrograms[i]);
    }
    return Array.from(unique);
  }

  private buildShellSpawnConfig(): { file: string; fileName: string; args: string[] } | null {
    const configured = this.plugin.settings.cli.shellExecutable.trim();
    const shell = configured !== '' ? configured : isWindows() ? 'powershell.exe' : '/bin/bash';
    const fileName = shell.split('.')[0];
    return { file: shell, fileName, args: [] };
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

  private sanitizeConversationTitleForVault(rawTitle: string): string {
    const invalidChars = /[*"<>:\\/|?]/g;
    const collapsed = rawTitle.replace(invalidChars, '').replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) {
      return collapsed;
    }
    return CLI_NOTE_PREFIX;
  }

  /**
   * Stable vault conversation title for the host's interactive (xterm) note, without creating the file.
   * Matches {@link ensureCliXtermConversationNote} naming so the shell can spawn before the note exists.
   */
  public getCliXtermNoteTitleForHost(hostConversationTitle: string): string {
    return this.sanitizeConversationTitleForVault(
      `${CLI_NOTE_PREFIX}_${hostConversationTitle.trim()}`
    );
  }

  private extractCdCommandsFromArgsLine(argsLine: string): string[] {
    if (argsLine.trim().length === 0) {
      return [];
    }
    const segments = argsLine
      .split(/\r?\n|&&|\|\||;/)
      .map(segment => segment.trim())
      .filter(segment => segment.length > 0);
    const cdCommands: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!/^cd(?:\s+|$)/i.test(segment)) {
        continue;
      }
      cdCommands.push(segment);
    }
    return cdCommands;
  }

  public recordCdCommandsFromQuery(params: { conversationTitle: string; argsLine: string }): void {
    const session = this.sessions.get(params.conversationTitle);
    if (!session) {
      return;
    }
    const cdCommands = this.extractCdCommandsFromArgsLine(params.argsLine);
    if (cdCommands.length === 0) {
      return;
    }
    session.cdCommandHistory.push(...cdCommands);
    if (session.cdCommandHistory.length > 200) {
      session.cdCommandHistory = session.cdCommandHistory.slice(-200);
    }
  }

  private parsePwdProbeOutput(output: string): string | null {
    if (output.trim().length === 0) {
      return null;
    }
    const lines = output.replace(/\r/g, '').split('\n');
    const startIndex = lines.findIndex(l => l.includes(PWD_START));
    if (startIndex < 0) {
      return null;
    }
    const endIndex = lines.findIndex((l, i) => i > startIndex && l.includes(PWD_END));
    if (endIndex < 0) {
      return null;
    }
    const inner = lines.slice(startIndex + 1, endIndex);
    for (let i = inner.length - 1; i >= 0; i--) {
      const candidate = inner[i].trim();
      if (candidate.length > 0) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Returns the probe binary and args needed to replay {@link cdCommands} and print the resolved
   * working directory between sentinels.
   *
   * The probe shell is chosen based on the OS — not the user's configured shell — because the
   * resulting path must be in the format that the OS's native process-spawn APIs accept.
   * On Windows that means a Windows path (from PowerShell); on other platforms a POSIX path
   * (from the system sh).
   *
   * TODO: Windows + POSIX shell (e.g. bash.exe / Git Bash) edge case — cd commands stored from a
   * bash session use POSIX-style paths which PowerShell cannot replay directly.  Conversion
   * (cygpath / WSL path mapping) is deferred for a future iteration.
   */
  private buildPwdProbe(cdCommands: string[]): { file: string; args: string[] } {
    if (isWindows()) {
      const scriptLines = [...cdCommands];
      scriptLines.push(`Write-Output "${PWD_START}"`);
      scriptLines.push('(Get-Location).Path');
      scriptLines.push(`Write-Output "${PWD_END}"`);
      return {
        file: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-Command', scriptLines.join(';\n')],
      };
    }

    const scriptLines = [...cdCommands];
    scriptLines.push(`printf '%s\\n' "${PWD_START}"`);
    scriptLines.push('pwd');
    scriptLines.push(`printf '%s\\n' "${PWD_END}"`);
    return {
      file: '/bin/sh',
      args: ['-c', scriptLines.join('\n')],
    };
  }

  private async probeWorkingDirectoryFromCdHistory(cdCommands: string[]): Promise<string | null> {
    if (cdCommands.length === 0) {
      return null;
    }
    const cp = await loadNodeModule('child_process').catch(error => {
      logger.error('CliSessionService failed to load child_process for cwd probe:', error);
    });
    if (!cp) {
      return null;
    }

    const probe = this.buildPwdProbe(cdCommands);
    const startingCwd = this.resolveWorkingDirectory();

    return new Promise(resolve => {
      let stdout = '';
      const child = cp.spawn(probe.file, probe.args, {
        cwd: startingCwd,
        env: this.cliChildEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        shell: false,
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.once('error', () => resolve(null));
      child.once('close', () => {
        resolve(this.parsePwdProbeOutput(stdout));
      });
    });
  }

  public async resolveWorkingDirectoryFromTranscriptCdHistory(
    conversationTitle: string
  ): Promise<string | undefined> {
    const session = this.sessions.get(conversationTitle);
    if (!session || session.cliMode !== 'transcript') {
      return undefined;
    }
    return (await this.probeWorkingDirectoryFromCdHistory(session.cdCommandHistory)) ?? undefined;
  }

  /**
   * When the xterm session ends, declare that the xterm note is forwarded to the host.
   */
  private async markXtermAsForwardedToHost(xtermConversationTitle: string): Promise<void> {
    const hostConversationTitle =
      await this.getCliXtermHostConversationTitle(xtermConversationTitle);
    if (!hostConversationTitle) {
      return;
    }
    await this.plugin.wikilinkForwardService.setForwardedTo({
      sourceConversationTitle: xtermConversationTitle,
      targetConversationTitle: hostConversationTitle,
    });
  }

  public async getCliXtermHostConversationTitle(conversationTitle: string): Promise<string | null> {
    const host = await this.plugin.conversationRenderer.getConversationProperty<string>(
      conversationTitle,
      'host_conversation'
    );
    if (!host || host.trim().length === 0) {
      return null;
    }
    return host.trim();
  }

  public async ensureCliXtermConversationNote(params: {
    hostConversationTitle: string;
    query?: string;
  }): Promise<string> {
    const hostConversationTitle = params.hostConversationTitle.trim();
    const normalizedQuery = params.query?.split(/\r?\n/)[0]?.trim() ?? '';
    const shellConfig = this.buildShellSpawnConfig();
    const conversationTitle =
      normalizedQuery.length > 0
        ? `${normalizedQuery} - ${shellConfig?.fileName}`
        : shellConfig?.fileName;
    const xtermTitle = this.getCliXtermNoteTitleForHost(hostConversationTitle);

    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${xtermTitle}.md`;

    const folderExists = this.plugin.app.vault.getFolderByPath(folderPath);
    if (!folderExists) {
      await this.plugin.app.vault.createFolder(folderPath);
    }

    const file = this.plugin.app.vault.getFileByPath(notePath);
    if (!file) {
      const frontmatter = yamlDump(
        {
          host_conversation: hostConversationTitle,
          session: xtermTitle,
          conversation_title: conversationTitle,
        },
        { lineWidth: -1 }
      ).trimEnd();
      const initialContent = `---\n${frontmatter}\n---\n\n${CLI_XTERM_MARKER}\n`;
      await this.plugin.app.vault.create(notePath, initialContent);
    } else {
      await this.plugin.app.vault.process(file, content => {
        if (content.includes(CLI_XTERM_MARKER)) {
          return content;
        }
        return `${content.trimEnd()}\n\n${CLI_XTERM_MARKER}\n`;
      });
    }

    const ensuredFile = this.plugin.app.vault.getFileByPath(notePath);
    if (ensuredFile) {
      await this.plugin.app.fileManager.processFrontMatter(ensuredFile, frontmatter => {
        const frontmatterAsRecord = frontmatter as Record<string, unknown>;
        const keys = Object.keys(frontmatterAsRecord);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (key === 'host_conversation' || key === 'session' || key === 'conversation_title') {
            continue;
          }
          delete frontmatterAsRecord[key];
        }
        frontmatterAsRecord.host_conversation = hostConversationTitle;
        frontmatterAsRecord.session = xtermTitle;
        frontmatterAsRecord.conversation_title = conversationTitle;
      });
    }

    return xtermTitle;
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

  /**
   * Flush output manually when:
   * - Start a new segment
   * - Start a interactive session from an existing transcript session.
   */
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
      if (isWindows()) {
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
   * Stores the session and attaches shared stream / lifecycle handlers for transcript and remote PTY children.
   */
  private registerCliSession(session: CliSession): void {
    this.sessions.set(session.conversationTitle, session);
    this.refreshCommandInputDecorations();

    session.child.stdout.setEncoding('utf8');
    session.child.stderr.setEncoding('utf8');

    session.child.stdout.on('data', (chunk: string) => {
      this.appendOutput(session.conversationTitle, chunk, false);
    });
    session.child.stderr.on('data', (chunk: string) => {
      this.appendOutput(session.conversationTitle, chunk, true);
    });
    session.child.on('error', err => {
      logger.error('CliSessionService child error:', err);
      this.appendOutput(session.conversationTitle, `\n[error] ${String(err)}\n`, true);
    });

    session.child.on('close', (code, signal) => {
      const current = this.sessions.get(session.conversationTitle);
      if (!current || current.child !== session.child) {
        return;
      }
      const exitNote =
        signal !== null
          ? i18next.t('cli.processEndedSignal', { signal: String(signal) })
          : i18next.t('cli.processEndedCode', { code: String(code) });
      this.appendOutput(session.conversationTitle, `\n${exitNote}\n`, false);
      void this.flushOutput(current, true).then(() => {
        this.endSession({
          conversationTitle: session.conversationTitle,
          killProcess: false,
        });
      });
    });
  }

  /**
   * Spawn a shell for {@link conversationTitle} and register stdout/stderr listeners.
   */
  public async startShellProcess(params: {
    conversationTitle: string;
    hostConversationTitle?: string;
    streamMarker: string;
    workingDirectory?: string;
    /** Used to choose PTY vs child_process on first spawn (empty → transcript). */
    initialArgsLine?: string;
  }): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
    if (!Platform.isDesktopApp) {
      return { ok: false, errorMessage: i18next.t('cli.desktopOnly') };
    }

    const hostConversationTitle = params.hostConversationTitle ?? params.conversationTitle;
    const cwd = params.workingDirectory ?? this.resolveWorkingDirectory();

    const spawnConfig = this.buildShellSpawnConfig();
    if (!spawnConfig) {
      return { ok: false, errorMessage: 'no shell configuration' };
    }

    const initialLine = params.initialArgsLine ?? '';
    const useInteractivePty = isInteractiveCliCommand(
      initialLine,
      this.getSupportedInteractiveApps()
    );
    const companion = useInteractivePty
      ? this.plugin.ptyCompanionService.getConnectionParams()
      : null;

    if (useInteractivePty) {
      const ptyNativeDir = await resolveVaultPtyNativePath(this.plugin);
      if (!ptyNativeDir) {
        return { ok: false, errorMessage: i18next.t('cli.ptyNativePathUnavailable') };
      }

      let bundlePresent = false;
      try {
        const fsMod = await loadNodeModule('fs');
        bundlePresent =
          fsMod.existsSync(ptyNativeDir) && fsMod.statSync(ptyNativeDir).isDirectory();
      } catch {
        bundlePresent = false;
      }
      if (!bundlePresent) {
        return {
          ok: false,
          errorMessage: i18next.t('cli.ptyNativeBundleMissing', { path: ptyNativeDir }),
        };
      }

      if (!companion) {
        return {
          ok: false,
          errorMessage:
            'Interactive commands (e.g. vim) need the PTY companion running with node-pty available.',
        };
      }

      let ptySession: Awaited<ReturnType<typeof createRemotePtySession>>;
      try {
        ptySession = await createRemotePtySession({
          connection: companion,
          spawn: {
            file: spawnConfig.file,
            args: spawnConfig.args,
            cwd,
            env: this.cliInteractiveChildEnv(),
          },
        });
      } catch (error) {
        logger.error('CliSessionService remote PTY spawn failed:', error);
        return { ok: false, errorMessage: String(error) };
      }

      this.registerCliSession({
        conversationTitle: params.conversationTitle,
        hostConversationTitle,
        cliMode: 'interactive',
        child: ptySession.child,
        outputBuffer: '',
        flushTimer: null,
        operationId: '',
        pendingSentinelMarker: null,
        hideStreamMarkerNextFlush: false,
        cdCommandHistory: [],
        remoteKill: ptySession.remoteKill,
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
        detached: !isWindows(),
      });
    } catch (error) {
      logger.error('CliSessionService spawn failed:', error);
      return { ok: false, errorMessage: String(error) };
    }

    this.registerCliSession({
      conversationTitle: params.conversationTitle,
      hostConversationTitle,
      cliMode: 'transcript',
      child,
      outputBuffer: '',
      flushTimer: null,
      operationId: '',
      pendingSentinelMarker: null,
      hideStreamMarkerNextFlush: false,
      cdCommandHistory: [],
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
    const shouldKill = params.killProcess !== false;
    if (shouldKill) {
      void this.interruptSession(session);
    }
    this.plugin.abortService.abortOperation(session.operationId);
    this.sessions.delete(params.conversationTitle);
    this.refreshCommandInputDecorations();
    void this.markXtermAsForwardedToHost(params.conversationTitle);
    void this.updateStreamMarkerInNote({
      conversationTitle: params.conversationTitle,
      action: 'remove',
    });
  }

  public appendSentinelMarker(session: CliSession, argsLine: string) {
    const shellFile = this.buildShellSpawnConfig()?.file ?? '';
    const eol = this.ptySubmitLineEnding(shellFile);
    if (session.cliMode === 'interactive') {
      session.child.stdin.write(`${argsLine}${eol}`);
      return;
    }

    session.pendingSentinelMarker = SENTINEL_MARKER;

    // Write the real command, then immediately echo the sentinel
    session.child.stdin.write(`${argsLine}${eol}echo ${SENTINEL_MARKER}${eol}`);
  }

  /**
   * Line ending to inject after a full command when writing to a shell's stdin (PTY or piped).
   * POSIX-family shells (bash, sh, zsh, fish, dash) always use LF, even when hosted on Windows.
   * Native Windows shells (powershell, cmd, pwsh) require CRLF on Windows so the line is submitted.
   */
  private ptySubmitLineEnding(shellFile: string): string {
    if (!isWindows()) {
      return '\n';
    }
    const base = shellFile.split(/[\\/]/).pop() ?? shellFile;
    const name = base.replace(/\.exe$/i, '').toLowerCase();
    const posixShells = ['bash', 'sh', 'zsh', 'fish', 'dash'];
    const isPosix = posixShells.some(s => name === s || name.endsWith(s));
    return isPosix ? '\n' : '\r\n';
  }

  private appendOutput(conversationTitle: string, chunk: string, isStderr: boolean): void {
    const session = this.sessions.get(conversationTitle);
    if (!session) {
      logger.warn('CLI session not found');
      return;
    }

    const stripResult = this.stripSentinelMarker(chunk);

    if (stripResult.stripped) {
      session.hideStreamMarkerNextFlush = true;
    }

    // Check for and strip the sentinel line
    if (session.pendingSentinelMarker && chunk.includes(SENTINEL_MARKER)) {
      session.pendingSentinelMarker = null;

      // If there was real content in this chunk before the sentinel, handle it normally
      if (stripResult.content.trim()) {
        session.outputBuffer += stripResult.content;
      }

      // No output at all before the sentinel → inject the placeholder
      if (!session.outputBuffer) {
        session.outputBuffer += '(No output)\n';
      }
    } else {
      const prefix = isStderr ? '[stderr] ' : '';
      session.outputBuffer += `${prefix}${stripResult.content}`;
    }

    this.scheduleFlush(session);
  }

  /**
   * Removes every line that contains the done sentinel (e.g. `echo __STEWARD_DONE__` noise).
   * Other lines and their order are preserved.
   */
  private stripSentinelMarker(chunk: string): { stripped: boolean; content: string } {
    if (!chunk.includes(SENTINEL_MARKER)) {
      return {
        stripped: false,
        content: chunk,
      };
    }
    return {
      stripped: true,
      content: chunk
        .split(/\r?\n/)
        .filter(line => !line.includes(SENTINEL_MARKER))
        .join('\n'),
    };
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
    const safe = sanitizeFenceContent(await this.normalizeCliOutputForNote(toWrite));
    try {
      const file = this.plugin.conversationRenderer.getConversationFileByName(
        session.conversationTitle
      );
      await this.plugin.app.vault.process(file, content => {
        const streamMarkerRegex = new RegExp(CLI_STREAM_MARKER);
        if (!streamMarkerRegex.test(content)) {
          return content;
        }
        return content.replace(streamMarkerRegex, marker => `${safe}${marker}`);
      });
      if (session.hideStreamMarkerNextFlush) {
        session.hideStreamMarkerNextFlush = false;
        await this.updateStreamMarkerInNote({
          conversationTitle: session.conversationTitle,
          action: 'hide',
        });
      }
    } catch (error) {
      logger.error('CliSessionService flush failed:', error);
      session.hideStreamMarkerNextFlush = false;
    }
  }
}
