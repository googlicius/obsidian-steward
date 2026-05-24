import { z } from 'zod/v3';
import { Line } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { AgentResult, IntentResultStatus } from '../../types';
import { logger } from 'src/utils/logger';

const newSessionSchema = z.object({
  query: z.string().optional(),
});

export type NewSessionArgs = z.infer<typeof newSessionSchema>;

export class NewSession {
  private static readonly STATIC_NEW_SESSION_PHRASES = ['new', 'new session', 'new chat'] as const;

  constructor(private readonly agent: AgentHandlerContext) {}

  private get plugin() {
    return this.agent.plugin;
  }

  public static async getNewSessionTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: newSessionSchema,
    });
  }

  private stripNewSessionStaticPhrase(query: string): string {
    const trimmed = query.trim();
    if (!trimmed) {
      return '';
    }

    const lower = trimmed.toLowerCase();
    for (const phrase of NewSession.STATIC_NEW_SESSION_PHRASES) {
      if (lower === phrase) {
        return '';
      }
      const prefix = `${phrase} `;
      if (lower.startsWith(prefix)) {
        return trimmed.slice(phrase.length).trim();
      }
    }

    return trimmed;
  }

  /**
   * Persist the closing conversation's model as the default chat model when it differs from settings.
   */
  private async syncChatModelFromConversation(conversationModel?: string): Promise<void> {
    const model = conversationModel?.trim();
    if (!model || model === this.plugin.settings.llm.chat.model) {
      return;
    }

    this.plugin.settings.llm.chat.model = model;
    await this.plugin.saveSettings();
  }

  /** Replace the line at the cursor with `/ ` or `/ <query>`. */
  private insertInputAtCursor(view: EditorView, query: string): Line {
    const { doc, selection } = view.state;
    const head = Math.min(selection.main.head, doc.length);
    const line = doc.lineAt(head);
    const insertText = query ? `/ ${query}` : '/ ';

    view.dispatch({
      changes: { from: line.from, to: line.to, insert: insertText },
      selection: { anchor: line.from + insertText.length },
    });

    this.plugin.editor?.focus();
    return view.state.doc.lineAt(line.from);
  }

  /**
   * Start a new session by closing the current session, if has query, start a new conversation.
   */
  private async startNewSession(view: EditorView, query: string): Promise<void> {
    const conversationTitle = this.plugin.findConversationTitleAbove(view);
    if (conversationTitle) {
      await this.plugin.closeConversation(conversationTitle);
    }

    const commandLine = this.insertInputAtCursor(view, query);

    if (query) {
      this.plugin.processCommandFromView(view, commandLine);
    }
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<NewSessionArgs> }
  ): Promise<AgentResult> {
    const editor = this.plugin.editor;
    if (!editor) {
      logger.warn('NewSession.handle: no active editor');
      return { status: IntentResultStatus.STOP_PROCESSING };
    }

    const view = editor.cm;
    const rawQuery = options.toolCall.input.query ?? ctx.intent?.query ?? '';
    const query = this.stripNewSessionStaticPhrase(rawQuery);

    await this.syncChatModelFromConversation(ctx.intent?.model);
    await this.startNewSession(view, query);

    return {
      status: IntentResultStatus.STOP_PROCESSING,
    };
  }
}
