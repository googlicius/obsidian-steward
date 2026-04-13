import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import i18next from 'i18next';
import { logger } from 'src/utils/logger';
import { CLI_STREAM_MARKER } from 'src/services/CliSessionService/cliTranscriptMarker';
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

  private async beginNextTranscriptSegment(conversationTitle: string): Promise<void> {
    const session = this.cliSessionService.getSession(conversationTitle);
    if (!session) {
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
    if (!this.agent.plugin.settings.cli.enabled) {
      await this.agent.renderer.updateConversationNote({
        path: params.conversationTitle,
        newContent: i18next.t('cli.disabledNotice'),
        command: 'cli',
        includeHistory: false,
      });
      return;
    }

    this.cliSessionService.endSession({
      conversationTitle: params.conversationTitle,
      killProcess: true,
    });

    const started = await this.cliSessionService.startShellProcess({
      conversationTitle: params.conversationTitle,
      streamMarker: CLI_STREAM_MARKER,
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

    const initialBody = i18next.t('cli.shellTranscriptIntro');
    const newContent = `${initialBody}\n\n\`\`\`cli-transcript\n${CLI_STREAM_MARKER}\n\`\`\`\n`;

    await this.agent.renderer.updateConversationNote({
      path: params.conversationTitle,
      newContent,
      command: 'cli',
      includeHistory: false,
    });

    const session = this.cliSessionService.getSession(params.conversationTitle);
    if (params.argsLine.length > 0 && session && !session.child.stdin.writableEnded) {
      // session.child.stdin.write(`${params.argsLine}\n`);
      this.cliSessionService.appendSentinelMarker(session, params.argsLine);
    }
  }

  private async continueOrStartShellSession(params: {
    conversationTitle: string;
    argsLine: string;
  }): Promise<void> {
    const continued = await this.tryContinueSession(params);
    if (!continued) {
      await this.startSession(params);
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

    await this.continueOrStartShellSession({
      conversationTitle: params.title,
      argsLine,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
