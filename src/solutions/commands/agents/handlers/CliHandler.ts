import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import i18next from 'i18next';
import { logger } from 'src/utils/logger';
import { CLI_STREAM_MARKER, CLI_XTERM_MARKER } from 'src/services/CliSessionService/constants';
import { isInteractiveCliCommand } from 'src/services/CliSessionService/CliSessionService';
import { TWO_SPACES_PREFIX } from 'src/constants';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';

const shellToolInputSchema = z.object({
  argsLine: z.string().optional().default(''),
});

export type ShellToolInput = z.infer<typeof shellToolInputSchema>;

/** Local shell transcript orchestration; session state lives in {@link CliSessionService}. */
export class CliHandler {
  constructor(private readonly agent: AgentHandlerContext) {}

  private get cliSessionService() {
    return this.agent.plugin.cliSessionService;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private indexToEditorPosition(text: string, index: number): { line: number; ch: number } {
    const boundedIndex = Math.max(0, Math.min(index, text.length));
    let line = 0;
    let lineStart = 0;

    for (let i = 0; i < boundedIndex; i++) {
      if (text.charAt(i) !== '\n') {
        continue;
      }
      line += 1;
      lineStart = i + 1;
    }

    return {
      line,
      ch: boundedIndex - lineStart,
    };
  }

  private transformEmbedAndInputBlock(params: {
    content: string;
    sourceEmbedPattern: RegExp;
    replacementEmbed: string;
  }): { updatedContent: string; didReplace: boolean } {
    const match = params.sourceEmbedPattern.exec(params.content);
    if (!match || typeof match.index !== 'number') {
      return { updatedContent: params.content, didReplace: false };
    }

    const embedStart = match.index;
    const embedEnd = match.index + match[0].length;
    let removeEnd = embedEnd;
    let cursor = embedEnd;

    while (cursor < params.content.length) {
      const char = params.content.charAt(cursor);
      if (char !== '\n' && char !== '\r' && char !== ' ' && char !== '\t') {
        break;
      }
      cursor += 1;
    }

    const lineStart = cursor;
    if (lineStart >= params.content.length || params.content.charAt(lineStart) !== '/') {
      const updatedContent =
        params.content.slice(0, embedStart) +
        params.replacementEmbed +
        params.content.slice(embedEnd);
      return { updatedContent, didReplace: true };
    }

    let lineEnd = params.content.indexOf('\n', lineStart);
    if (lineEnd === -1) {
      lineEnd = params.content.length;
    } else {
      lineEnd += 1;
    }
    removeEnd = lineEnd;

    while (removeEnd < params.content.length) {
      const nextLineEndRaw = params.content.indexOf('\n', removeEnd);
      const nextLineEnd = nextLineEndRaw === -1 ? params.content.length : nextLineEndRaw;
      const rawLine = params.content.slice(removeEnd, nextLineEnd).replace(/\r$/, '');
      if (!rawLine.startsWith(TWO_SPACES_PREFIX)) {
        break;
      }
      removeEnd = nextLineEndRaw === -1 ? nextLineEnd : nextLineEnd + 1;
    }

    const updatedContent =
      params.content.slice(0, embedStart) +
      params.replacementEmbed +
      params.content.slice(removeEnd);
    return { updatedContent, didReplace: true };
  }

  private async replaceConversationEmbedInActiveNote(params: {
    sourceConversationTitle: string;
    targetConversationTitle: string;
  }): Promise<void> {
    const escapedSource = this.escapeRegExp(params.sourceConversationTitle);
    const escapedFolder = this.escapeRegExp(this.agent.plugin.settings.stewardFolder);
    const sourceEmbedPattern = new RegExp(
      `!\\[\\[(?:${escapedFolder}\\/Conversations\\/)?${escapedSource}(?:\\.md)?\\]\\]`
    );
    const replacementEmbed = `![[${this.agent.plugin.settings.stewardFolder}/Conversations/${params.targetConversationTitle}]]`;

    const activeEditor = this.agent.plugin.editor;
    if (activeEditor) {
      const editorContent = activeEditor.getValue();
      const transformed = this.transformEmbedAndInputBlock({
        content: editorContent,
        sourceEmbedPattern,
        replacementEmbed,
      });
      if (transformed.didReplace) {
        const from = this.indexToEditorPosition(editorContent, 0);
        const to = this.indexToEditorPosition(editorContent, editorContent.length);
        activeEditor.replaceRange(transformed.updatedContent, from, to);
        return;
      }
    }

    const activeFile = this.agent.app.workspace.getActiveFile();
    if (!activeFile) {
      return;
    }

    await this.agent.app.vault.process(activeFile, content => {
      const transformed = this.transformEmbedAndInputBlock({
        content,
        sourceEmbedPattern,
        replacementEmbed,
      });
      if (!transformed.didReplace) {
        return content;
      }
      return transformed.updatedContent;
    });
  }

  private async resolveTargetConversationTitle(params: {
    conversationTitle: string;
    argsLine: string;
  }): Promise<string> {
    if (
      !isInteractiveCliCommand(params.argsLine, this.cliSessionService.getSupportedInteractiveApps())
    ) {
      return params.conversationTitle;
    }

    const hostConversationTitle = await this.cliSessionService.getCliXtermHostConversationTitle(
      params.conversationTitle
    );
    if (hostConversationTitle) {
      return params.conversationTitle;
    }

    const xtermConversationTitle = await this.cliSessionService.ensureCliXtermConversationNote({
      hostConversationTitle: params.conversationTitle,
      query: params.argsLine,
    });

    const hostSession = this.cliSessionService.getSession(params.conversationTitle);
    if (hostSession && hostSession.cliMode === 'transcript') {
      await this.beginNextTranscriptSegment(params.conversationTitle);
      this.cliSessionService.appendInfoTextToTranscript(
        params.conversationTitle,
        i18next.t('cli.openingInteractiveTerminal')
      );
      await this.cliSessionService.flushOutputForConversation(params.conversationTitle, true);
    } else {
      await this.agent.renderer.updateConversationNote({
        path: params.conversationTitle,
        newContent: i18next.t('cli.openingInteractiveTerminal'),
        command: 'cli',
        includeHistory: false,
      });
    }

    await this.replaceConversationEmbedInActiveNote({
      sourceConversationTitle: params.conversationTitle,
      targetConversationTitle: xtermConversationTitle,
    });

    return xtermConversationTitle;
  }

  private async isCliXtermConversation(conversationTitle: string): Promise<boolean> {
    const host = await this.cliSessionService.getCliXtermHostConversationTitle(conversationTitle);
    return host !== null;
  }

  private async beginNextTranscriptSegment(conversationTitle: string): Promise<void> {
    const session = this.cliSessionService.getSession(conversationTitle);
    if (!session) {
      return;
    }
    if (
      session.cliMode === 'interactive' &&
      (await this.isCliXtermConversation(conversationTitle))
    ) {
      return;
    }
    const markerToStrip = session.streamMarker;
    this.cliSessionService.cancelFlushTimer(session);
    await this.cliSessionService.flushOutputForConversation(conversationTitle, true);
    try {
      const file = this.agent.renderer.getConversationFileByName(conversationTitle);
      await this.agent.app.vault.process(file, content => {
        if (!content.includes(markerToStrip)) {
          return content;
        }
        return content.replace(markerToStrip, '');
      });
    } catch (error) {
      logger.error('CliHandler beginNextTranscriptSegment strip marker failed:', error);
    }
    const fenced = `\n\n\`\`\`cli-transcript\n${CLI_STREAM_MARKER}\n\`\`\`\n`;
    await this.agent.renderer.updateConversationNote({
      path: conversationTitle,
      newContent: fenced,
      command: 'cli',
      includeHistory: false,
    });
  }

  private async tryContinueSession(params: {
    conversationTitle: string;
    argsLine: string;
  }): Promise<boolean> {
    const session = this.cliSessionService.getSession(params.conversationTitle);
    if (!session) {
      return false;
    }
    if (session.child.stdin.writableEnded) {
      return false;
    }
    if (params.argsLine.length > 0) {
      // End the session if different mode.
      const wantsInteractive = isInteractiveCliCommand(
        params.argsLine,
        this.cliSessionService.getSupportedInteractiveApps()
      );
      const sessionIsInteractive = session.cliMode === 'interactive';
      if (wantsInteractive !== sessionIsInteractive) {
        this.cliSessionService.endSession({
          conversationTitle: params.conversationTitle,
          killProcess: true,
        });
        return false;
      }
    }
    await this.beginNextTranscriptSegment(params.conversationTitle);
    const live = this.cliSessionService.getSession(params.conversationTitle);
    if (params.argsLine.length > 0 && live && !live.child.stdin.writableEnded) {
      this.cliSessionService.appendSentinelMarker(live, params.argsLine);
    }
    return true;
  }

  private async startSession(params: {
    conversationTitle: string;
    argsLine: string;
  }): Promise<void> {
    this.cliSessionService.endSession({
      conversationTitle: params.conversationTitle,
      killProcess: true,
    });

    const hostConversationTitle =
      (await this.cliSessionService.getCliXtermHostConversationTitle(params.conversationTitle)) ??
      params.conversationTitle;

    const wantsInteractive = isInteractiveCliCommand(
      params.argsLine,
      this.cliSessionService.getSupportedInteractiveApps()
    );
    const hostTranscriptSession = this.cliSessionService.getSession(hostConversationTitle);
    const inheritedWorkingDirectory =
      wantsInteractive && hostTranscriptSession?.cliMode === 'transcript'
        ? hostTranscriptSession.preferredWorkingDirectory
        : undefined;

    const started = await this.cliSessionService.startShellProcess({
      conversationTitle: params.conversationTitle,
      hostConversationTitle,
      streamMarker: CLI_STREAM_MARKER,
      workingDirectory: inheritedWorkingDirectory,
      initialArgsLine: params.argsLine,
    });

    if (!started.ok) {
      const message = i18next.t('cli.spawnFailed', { message: started.errorMessage });
      await this.agent.renderer.updateConversationNote({
        path: params.conversationTitle,
        newContent: message,
        command: 'cli',
        includeHistory: false,
      });
      return;
    }

    const session = this.cliSessionService.getSession(params.conversationTitle);
    const isInteractiveXterm =
      session?.cliMode === 'interactive' &&
      (await this.isCliXtermConversation(params.conversationTitle));

    if (isInteractiveXterm) {
      const file = this.agent.renderer.getConversationFileByName(params.conversationTitle);
      await this.agent.app.vault.process(file, content => {
        if (content.includes(CLI_XTERM_MARKER)) {
          return content;
        }
        return `${content.trimEnd()}\n\n${CLI_XTERM_MARKER}\n`;
      });
    } else {
      const initialBody = i18next.t('cli.shellTranscriptIntro');
      const newContent = `${initialBody}\n\n\`\`\`cli-transcript\n${CLI_STREAM_MARKER}\n\`\`\`\n`;

      await this.agent.renderer.updateConversationNote({
        path: params.conversationTitle,
        newContent,
        command: 'cli',
        includeHistory: false,
      });
    }

    if (params.argsLine.length > 0 && session && !session.child.stdin.writableEnded) {
      // session.child.stdin.write(`${params.argsLine}\n`);
      this.cliSessionService.appendSentinelMarker(session, params.argsLine);
    }
  }

  /**
   * Manual shell session: continue stdin or start a new local shell transcript for this conversation.
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<ShellToolInput>;
      continueFromNextTool?: () => Promise<AgentResult>;
      toolContentStreamInfo?: unknown;
    }
  ): Promise<AgentResult> {
    const parsed = shellToolInputSchema.safeParse(options.toolCall.input);
    const argsLine = parsed.success ? parsed.data.argsLine : '';

    const targetConversationTitle = await this.resolveTargetConversationTitle({
      conversationTitle: params.title,
      argsLine,
    });

    const continued = await this.tryContinueSession({
      conversationTitle: targetConversationTitle,
      argsLine,
    });

    if (!continued) {
      await this.startSession({
        conversationTitle: targetConversationTitle,
        argsLine,
      });
    }

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
