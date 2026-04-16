import { FileSystemAdapter, Platform } from 'obsidian';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { loadNodeModule } from 'src/utils/loadNodeModule';
import i18next from 'i18next';
import stripAnsi from 'strip-ansi';
import { dump as yamlDump } from 'js-yaml';
import path from 'path';
import os from 'os';
import {
  createRemotePtySession,
  type RemotePtyChildShim,
} from 'src/solutions/pty-companion/client';
import { CLI_XTERM_MARKER } from './constants';

const SENTINEL_MARKER = `__STEWARD_DONE__`;

const isWin = process.platform === 'win32';
const BUILT_IN_INTERACTIVE_APPS = [
  'vim',
  'vi',
  'nvim',
  'nano',
  'gemini',
  'claude',
  'qwen',
  'hermes',
];

export type CliSessionMode = 'transcript' | 'interactive';

/** Simple routing: interactive (node-pty) when the command line starts with any supported app (trimmed, case-insensitive). */
export function isInteractiveCliCommand(
  argsLine: string,
  supportedInteractiveApps = BUILT_IN_INTERACTIVE_APPS
): boolean {
  const firstLine = argsLine.trimStart().split(/\r?\n/)[0] ?? '';
  if (firstLine.length === 0) {
    return false;
  }

  const firstSegment = firstLine.split(/&&|\|\||;/)[0]?.trim() ?? '';
  if (firstSegment.length === 0) {
    return false;
  }

  const firstToken = firstSegment.split(/\s+/)[0]?.toLowerCase() ?? '';
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

export interface CliSession {
  conversationTitle: string;
  hostConversationTitle: string;
  /** Transcript uses child_process + sentinel; interactive uses remote PTY (vim, …). */
  cliMode: CliSessionMode;
  child: ChildProcessWithoutNullStreams | RemotePtyChildShim;
  streamMarker: string;
  outputBuffer: string;
  flushTimer: number | null;
  operationId: string;
  pendingSentinelMarker: string | null; // marker we're waiting for
  /**
   * Logical cwd for this session only (updated on `cd` in transcript mode).
   * Each new session starts from the configured CLI working directory (vault root or settings).
   */
  preferredWorkingDirectory: string;
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
      .split(/[,\n]/)
      .map(app => app.trim().toLowerCase())
      .filter(app => app.length > 0);

    const unique = new Set<string>(BUILT_IN_INTERACTIVE_APPS);
    for (let i = 0; i < dynamicPrograms.length; i++) {
      unique.add(dynamicPrograms[i]);
    }
    return Array.from(unique);
  }

  private buildShellSpawnConfig(): { file: string; fileName: string; args: string[] } | null {
    const configured = this.plugin.settings.cli.shellExecutable.trim();
    const shell = configured !== '' ? configured : isWin ? 'powershell.exe' : '/bin/bash';
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

  private extractCdTarget(argsLine: string): string | null {
    const firstLine = argsLine.split(/\r?\n/)[0]?.trim() ?? '';
    if (firstLine.length === 0) {
      return null;
    }

    const commandOnly = firstLine.split(/&&|\|\||;/)[0]?.trim() ?? '';
    const match = /^cd(?:\s+(.+))?$/i.exec(commandOnly);
    if (!match) {
      return null;
    }

    const rawTarget = (match[1] ?? '').trim();
    if (rawTarget === '' || rawTarget === '~') {
      return os.homedir();
    }
    if (rawTarget === '-') {
      return null;
    }

    let normalizedTarget = rawTarget;
    if (
      (normalizedTarget.startsWith('"') && normalizedTarget.endsWith('"')) ||
      (normalizedTarget.startsWith("'") && normalizedTarget.endsWith("'"))
    ) {
      normalizedTarget = normalizedTarget.slice(1, -1);
    }

    if (normalizedTarget.startsWith('~')) {
      const withoutTilde = normalizedTarget.slice(1).replace(/^[/\\]/, '');
      return path.join(os.homedir(), withoutTilde);
    }

    return normalizedTarget;
  }

  private trackWorkingDirectoryFromTranscriptCommand(params: {
    session: CliSession;
    argsLine: string;
  }): void {
    const cdTarget = this.extractCdTarget(params.argsLine);
    if (!cdTarget) {
      return;
    }

    const current = params.session.preferredWorkingDirectory;
    const nextPath = path.isAbsolute(cdTarget) ? cdTarget : path.resolve(current, cdTarget);
    params.session.preferredWorkingDirectory = path.normalize(nextPath);
  }

  private sanitizeConversationTitleForVault(rawTitle: string): string {
    const invalidChars = /[*"<>:\\/|?]/g;
    const collapsed = rawTitle.replace(invalidChars, '').replace(/\s+/g, ' ').trim();
    if (collapsed.length > 0) {
      return collapsed;
    }
    return 'cli_xterm';
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private replaceEmbedInText(params: {
    content: string;
    sourceConversationTitle: string;
    targetConversationTitle: string;
    addInputBelow?: boolean;
  }): { updatedContent: string; didReplace: boolean } {
    const escapedSource = this.escapeRegExp(params.sourceConversationTitle);
    const escapedFolder = this.escapeRegExp(this.plugin.settings.stewardFolder);
    const sourceEmbedPattern = new RegExp(
      `!\\[\\[(?:${escapedFolder}\\/Conversations\\/)?${escapedSource}(?:\\.md)?\\]\\]`
    );
    const match = sourceEmbedPattern.exec(params.content);
    if (!match || typeof match.index !== 'number') {
      return { updatedContent: params.content, didReplace: false };
    }

    const replacementEmbed = `![[${this.plugin.settings.stewardFolder}/Conversations/${params.targetConversationTitle}]]`;
    const before = params.content.slice(0, match.index);
    const after = params.content.slice(match.index + match[0].length);
    if (!params.addInputBelow) {
      return {
        updatedContent: `${before}${replacementEmbed}${after}`,
        didReplace: true,
      };
    }

    const trimmedAfterStart = after.trimStart();
    if (trimmedAfterStart.startsWith('/')) {
      return {
        updatedContent: `${before}${replacementEmbed}${after}`,
        didReplace: true,
      };
    }

    return {
      updatedContent: `${before}${replacementEmbed}\n\n/ ${after}`,
      didReplace: true,
    };
  }

  private async restoreHostConversationEmbedIfNeeded(
    xtermConversationTitle: string
  ): Promise<void> {
    const hostConversationTitle =
      await this.getCliXtermHostConversationTitle(xtermConversationTitle);
    if (!hostConversationTitle) {
      return;
    }

    const activeEditor = this.plugin.editor;
    if (activeEditor) {
      const editorContent = activeEditor.getValue();
      const transformed = this.replaceEmbedInText({
        content: editorContent,
        sourceConversationTitle: xtermConversationTitle,
        targetConversationTitle: hostConversationTitle,
        addInputBelow: true,
      });
      if (transformed.didReplace) {
        activeEditor.setValue(transformed.updatedContent);
        return;
      }
    }

    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) {
      return;
    }
    await this.plugin.app.vault.process(activeFile, content => {
      const transformed = this.replaceEmbedInText({
        content,
        sourceConversationTitle: xtermConversationTitle,
        targetConversationTitle: hostConversationTitle,
        addInputBelow: true,
      });
      if (!transformed.didReplace) {
        return content;
      }
      return transformed.updatedContent;
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
    const xtermTitle = this.sanitizeConversationTitleForVault(
      `cli_xterm__${hostConversationTitle}`
    );

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
   * Stores the session and attaches shared stream / lifecycle handlers for transcript and remote PTY children.
   */
  private registerCliSession(session: CliSession): void {
    const { conversationTitle, child } = session;

    this.sessions.set(conversationTitle, session);
    this.refreshCommandInputDecorations();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      this.appendOutput(conversationTitle, chunk, false);
    });
    child.stderr.on('data', (chunk: string) => {
      this.appendOutput(conversationTitle, chunk, true);
    });
    child.on('error', err => {
      logger.error('CliSessionService child error:', err);
      this.appendOutput(conversationTitle, `\n[error] ${String(err)}\n`, true);
    });

    child.on('close', (code, signal) => {
      const current = this.sessions.get(conversationTitle);
      if (!current || current.child !== child) {
        return;
      }
      const exitNote =
        signal !== null
          ? i18next.t('cli.processEndedSignal', { signal: String(signal) })
          : i18next.t('cli.processEndedCode', { code: String(code) });
      this.appendOutput(conversationTitle, `\n${exitNote}\n`, false);
      void this.flushOutput(current, true).then(() => {
        this.endSession({ conversationTitle, killProcess: false });
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

      this.registerCliSession({
        conversationTitle: params.conversationTitle,
        hostConversationTitle,
        cliMode: 'interactive',
        child,
        streamMarker: params.streamMarker,
        outputBuffer: '',
        flushTimer: null,
        operationId: '',
        pendingSentinelMarker: null,
        preferredWorkingDirectory: cwd,
        remoteKill,
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

    this.registerCliSession({
      conversationTitle: params.conversationTitle,
      hostConversationTitle,
      cliMode: 'transcript',
      child,
      streamMarker: params.streamMarker,
      outputBuffer: '',
      flushTimer: null,
      operationId: '',
      pendingSentinelMarker: null,
      preferredWorkingDirectory: cwd,
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
    void this.restoreHostConversationEmbedIfNeeded(params.conversationTitle);
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

    this.trackWorkingDirectoryFromTranscriptCommand({
      session,
      argsLine,
    });

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
