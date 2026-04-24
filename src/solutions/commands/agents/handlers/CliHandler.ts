import { z } from 'zod/v3';
import { normalizePath, Platform } from 'obsidian';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import i18next from 'i18next';
import { logger } from 'src/utils/logger';
import { getBundledLib } from 'src/utils/bundledLibs';
import { GITHUB_WIKI_URL, WIKI_PAGES } from 'src/constants';
import {
  NODE_PTY_INSTALLER_SH_BASENAME,
  NODE_PTY_INSTALLER_PS1_BASENAME,
} from 'src/constants/nodePtyInstallerConstants';
import {
  CLI_STREAM_MARKER,
  CLI_XTERM_MARKER,
  getCliStreamMarkerPlaceholder,
} from 'src/services/CliSessionService/constants';
import { isInteractiveCliCommand } from 'src/services/CliSessionService/CliSessionService';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import { MANUAL_TOOL_CALL_ID_PREFIX } from 'src/constants';

export const shellToolInputSchema = z.object({
  argsLine: z
    .string()
    .optional()
    .default('')
    .describe(
      'Single line to send to the local shell transcript for this conversation (e.g. a shell command). Leave empty to start or continue a shell session without sending a line yet.'
    ),
});

export type ShellToolInput = z.infer<typeof shellToolInputSchema>;

/** Local shell transcript orchestration; session state lives in {@link CliSessionService}. */
export class CliHandler {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getShellTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: shellToolInputSchema,
    });
  }

  private get cliSessionService() {
    return this.agent.plugin.cliSessionService;
  }

  private buildCliSpawnFailedNoteContent(params: { errorMessage: string }): string {
    const stewardFolder = normalizePath(this.agent.plugin.settings.stewardFolder);

    if (!Platform.isDesktopApp) {
      return params.errorMessage;
    }

    const cliDoc = `${GITHUB_WIKI_URL}/${WIKI_PAGES.CLI}`;
    return [
      i18next.t('cli.spawnFailed', { message: params.errorMessage }),
      '',
      `**${i18next.t('cli.nodePtyInstallWindowsHeading')}**`,
      '',
      '```powershell',
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${stewardFolder}/${NODE_PTY_INSTALLER_PS1_BASENAME}"`,
      '```',
      '',
      `**${i18next.t('cli.nodePtyInstallUnixHeading')}**`,
      '',
      '```bash',
      `bash "${stewardFolder}/${NODE_PTY_INSTALLER_SH_BASENAME}"`,
      '```',
      '',
      i18next.t('cli.seeCliWiki', { cliDoc }),
    ].join('\n');
  }

  /**
   * Picks the conversation key used for {@link CliSessionService} routing without creating the xterm note.
   * For first-time interactive from a host note, that key is the deterministic xterm title so we can spawn first.
   */
  private async resolveShellSessionConversationTitle(params: {
    conversationTitle: string;
    argsLine: string;
  }): Promise<{
    shellSessionTitle: string;
    hostConversationTitleForSpawn?: string;
    materializeXtermFromHostTitle?: string;
  }> {
    if (
      !isInteractiveCliCommand(
        params.argsLine,
        this.cliSessionService.getSupportedInteractiveApps()
      )
    ) {
      return { shellSessionTitle: params.conversationTitle };
    }

    const linkedHost = await this.cliSessionService.getCliXtermHostConversationTitle(
      params.conversationTitle
    );
    if (linkedHost) {
      return { shellSessionTitle: params.conversationTitle };
    }

    const shellSessionTitle = this.cliSessionService.getCliXtermNoteTitleForHost(
      params.conversationTitle
    );
    return {
      shellSessionTitle,
      hostConversationTitleForSpawn: params.conversationTitle,
      materializeXtermFromHostTitle: params.conversationTitle,
    };
  }

  /** Creates the xterm conversation note and host UX after interactive shell spawn succeeded. */
  private async materializeCliXtermConversationAfterSpawn(params: {
    hostConversationTitle: string;
    xtermConversationTitle: string;
    argsLine: string;
  }): Promise<void> {
    await this.cliSessionService.ensureCliXtermConversationNote({
      hostConversationTitle: params.hostConversationTitle,
      query: params.argsLine,
    });

    const hostSession = this.cliSessionService.getSession(params.hostConversationTitle);
    if (hostSession && hostSession.cliMode === 'transcript') {
      await this.beginNextTranscriptSegment(
        params.hostConversationTitle,
        `${i18next.t('cli.openingInteractiveTerminal')}\n${getCliStreamMarkerPlaceholder({ hidden: true })}`
      );
    } else {
      await this.agent.renderer.updateConversationNote({
        path: params.hostConversationTitle,
        newContent: i18next.t('cli.openingInteractiveTerminal'),
        command: 'cli',
        includeHistory: false,
      });
    }

    // Declare that the host conversation is (temporarily) forwarded to the xterm note.
    // WikilinkForwardService listens for this metadata change and rewrites `![[host]]`
    // embeds to `![[xterm]]` (stripping the trailing `/ ` input line) across backlinks.
    // The forward is cleared when the xterm session ends — see CliSessionService.
    await this.agent.plugin.wikilinkForwardService.setForwardedTo({
      sourceConversationTitle: params.hostConversationTitle,
      targetConversationTitle: params.xtermConversationTitle,
    });
  }

  private async beginNextTranscriptSegment(
    conversationTitle: string,
    initialContent = getCliStreamMarkerPlaceholder()
  ): Promise<void> {
    const session = this.cliSessionService.getSession(conversationTitle);
    if (!session || session.cliMode === 'interactive') {
      return;
    }
    this.cliSessionService.cancelFlushTimer(session);
    await this.cliSessionService.flushOutputForConversation(conversationTitle, true);
    try {
      const file = this.agent.renderer.getConversationFileByName(conversationTitle);
      await this.agent.app.vault.process(file, content => {
        const markerRegex = new RegExp(CLI_STREAM_MARKER, 'g');
        if (!markerRegex.test(content)) {
          return content;
        }
        return content.replace(markerRegex, '');
      });
    } catch (error) {
      logger.error('CliHandler beginNextTranscriptSegment strip marker failed:', error);
    }
    const fenced = `\n\n\`\`\`cli-transcript\n${initialContent}\n\`\`\`\n`;
    await this.agent.renderer.updateConversationNote({
      path: conversationTitle,
      newContent: fenced,
      command: 'cli',
      includeHistory: false,
    });
  }

  private async tryContinueSession(params: {
    /** Whether the interactive or the non-interactive conversation note */
    conversationTitle: string;
    /** User query */
    argsLine: string;
  }): Promise<boolean> {
    const session = this.cliSessionService.getSession(params.conversationTitle);
    if (!session) {
      return false;
    }
    if (session.cliMode === 'interactive') {
      // There will be no continue query in interactive mode there because it performs in a terminal.
      return false;
    }
    if (session.child.stdin.writableEnded) {
      return false;
    }
    if (params.argsLine.length > 0) {
      this.cliSessionService.recordCdCommandsFromQuery({
        conversationTitle: params.conversationTitle,
        argsLine: params.argsLine,
      });
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
    hostConversationTitle?: string;
    workingDirectory?: string;
    /** When set, create the xterm note and host UX only after the shell spawns successfully. */
    materializeXtermFromHostTitle?: string;
  }): Promise<void> {
    this.cliSessionService.endSession({
      conversationTitle: params.conversationTitle,
      killProcess: true,
    });

    const started = await this.cliSessionService.startShellProcess({
      conversationTitle: params.conversationTitle,
      hostConversationTitle: params.hostConversationTitle,
      streamMarker: getCliStreamMarkerPlaceholder(),
      workingDirectory: params.workingDirectory,
      initialArgsLine: params.argsLine,
    });

    const errorNotePath = params.materializeXtermFromHostTitle ?? params.conversationTitle;

    if (!started.ok) {
      const message = this.buildCliSpawnFailedNoteContent({ errorMessage: started.errorMessage });
      await this.agent.renderer.updateConversationNote({
        path: errorNotePath,
        newContent: message,
        command: 'cli',
      });
      return;
    }

    if (params.materializeXtermFromHostTitle) {
      await this.materializeCliXtermConversationAfterSpawn({
        hostConversationTitle: params.materializeXtermFromHostTitle,
        xtermConversationTitle: params.conversationTitle,
        argsLine: params.argsLine,
      });
    }

    const session = this.cliSessionService.getSession(params.conversationTitle);
    const isInteractive = session?.cliMode === 'interactive';

    if (isInteractive) {
      const file = this.agent.renderer.getConversationFileByName(params.conversationTitle);
      await this.agent.app.vault.process(file, content => {
        if (content.includes(CLI_XTERM_MARKER)) {
          return content;
        }
        return `${content.trimEnd()}\n\n${CLI_XTERM_MARKER}\n`;
      });
    } else {
      const initialBody = i18next.t('cli.shellTranscriptIntro');
      const newContent = `${initialBody}\n\n\`\`\`cli-transcript\n${getCliStreamMarkerPlaceholder()}\n\`\`\`\n`;

      await this.agent.renderer.updateConversationNote({
        path: params.conversationTitle,
        newContent,
        command: 'cli',
      });
    }

    if (params.argsLine.length > 0 && session && !session.child.stdin.writableEnded) {
      this.cliSessionService.recordCdCommandsFromQuery({
        conversationTitle: params.conversationTitle,
        argsLine: params.argsLine,
      });
      this.cliSessionService.appendSentinelMarker(session, params.argsLine);
    }
  }

  /**
   * Runs the shell session logic (see {@link CliHandler.handle} for model-side confirmation).
   */
  private async runShellSession(params: AgentHandlerParams, argsLine: string): Promise<void> {
    const routing = await this.resolveShellSessionConversationTitle({
      conversationTitle: params.title,
      argsLine,
    });

    const continued = await this.tryContinueSession({
      conversationTitle: routing.shellSessionTitle,
      argsLine,
    });

    if (!continued) {
      const wantsInteractive = isInteractiveCliCommand(
        argsLine,
        this.cliSessionService.getSupportedInteractiveApps()
      );
      let workingDirectory: string | undefined;
      if (wantsInteractive) {
        const transcriptConversationTitle =
          routing.hostConversationTitleForSpawn ?? routing.shellSessionTitle;
        workingDirectory =
          await this.cliSessionService.resolveWorkingDirectoryFromTranscriptCdHistory(
            transcriptConversationTitle
          );
      }

      await this.startSession({
        conversationTitle: routing.shellSessionTitle,
        argsLine,
        hostConversationTitle: routing.hostConversationTitleForSpawn,
        workingDirectory,
        materializeXtermFromHostTitle: routing.materializeXtermFromHostTitle,
      });
    }
  }

  /**
   * Shell transcript for this conversation. Model-invoked tool calls require user confirmation;
   * client manual shell calls (toolCallId starts with MANUAL_TOOL_CALL_ID_PREFIX; e.g. `/>` input) run immediately.
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<ShellToolInput>;
      continueFromNextTool?: () => Promise<AgentResult>;
    }
  ): Promise<AgentResult> {
    const argsLine = options.toolCall.input?.argsLine ?? '';
    const { title, lang, handlerId } = params;
    const continueFromNextTool = options.continueFromNextTool;
    const isManualClientShellCall = options.toolCall.toolCallId.startsWith(
      MANUAL_TOOL_CALL_ID_PREFIX
    );

    if (!isManualClientShellCall) {
      const trimmed = argsLine.trim();
      const displayCommand =
        trimmed.length > 0 ? argsLine : i18next.t('cli.shellConfirmEmptyCommand');
      const message = i18next.t('cli.confirmExecuteShell', { command: displayCommand });

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        lang,
        handlerId,
        command: ToolName.SHELL,
      });

      return {
        status: IntentResultStatus.NEEDS_CONFIRMATION,
        confirmationMessage: message,
        onConfirmation: async (_confirmationMessage: string) => {
          await this.runShellSession(params, argsLine);
          if (continueFromNextTool) {
            return continueFromNextTool();
          }
          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
        onRejection: async (_rejectionMessage: string) => {
          this.agent.commandProcessor.deleteNextPendingIntent(title);
          if (continueFromNextTool) {
            return continueFromNextTool();
          }
          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
      };
    }

    await this.runShellSession(params, argsLine);
    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
