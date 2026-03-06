import { TFile } from 'obsidian';
import { logger } from 'src/utils/logger';
import { CompactionStore } from './CompactionStore';
import { CompactionSummaryAgent } from 'src/solutions/commands/agents/CompactionSummaryAgent';
import {
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
  type CompactionData,
  type CompactedEntry,
  type CompactedMessageEntry,
  type CompactedToolResult,
  type CompactorParams,
  type ToolResultCompactor,
} from './types';
import { ToolName } from 'src/solutions/commands/toolNames';
import {
  ReadContentCompactor,
  EditCompactor,
  CreateCompactor,
  RenameCompactor,
  CopyCompactor,
  MoveCompactor,
  DeleteCompactor,
  ImageCompactor,
  SpeechCompactor,
} from './compactors';
import type StewardPlugin from 'src/main';
import type { ConversationMessage } from 'src/types/types';
import type { ToolResultPart } from 'src/solutions/commands/tools/types';

const DEFAULT_VISIBLE_HISTORY_WINDOW = 10;

/** Tool results from these tools are compacted */
const COMPACTABLE_TOOL_NAMES = new Set<string>([
  ToolName.CONTENT_READING,
  ToolName.EDIT,
  ToolName.CREATE,
  ToolName.RENAME,
  ToolName.COPY,
  ToolName.MOVE,
  ToolName.DELETE,
  ToolName.IMAGE,
  ToolName.SPEECH,
]);
const SUMMARY_WORD_THRESHOLD = 100;

function countWords(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function isAssistantGenerated(role: string): boolean {
  return role === 'assistant' || role === 'steward';
}

function getPendingOutOfWindowMessages(params: {
  outOfWindowMessages: ConversationMessage[];
  lastCompactedMessageId?: string;
}): ConversationMessage[] {
  const { outOfWindowMessages, lastCompactedMessageId } = params;
  if (!lastCompactedMessageId) return outOfWindowMessages;
  const idx = outOfWindowMessages.findIndex(m => m.id === lastCompactedMessageId);
  if (idx < 0) return outOfWindowMessages;
  return outOfWindowMessages.slice(idx + 1);
}

export interface CompactionResult {
  systemMessage?: string;
  data: CompactionData;
}

export class CompactionOrchestrator {
  private readonly store: CompactionStore;
  private readonly summaryAgent: CompactionSummaryAgent;
  private readonly compactors: Map<string, ToolResultCompactor>;

  private get renderer() {
    return this.plugin.conversationRenderer;
  }

  constructor(private readonly plugin: StewardPlugin) {
    this.store = new CompactionStore(plugin.conversationRenderer);
    this.summaryAgent = new CompactionSummaryAgent(plugin);
    this.compactors = new Map<string, ToolResultCompactor>();
    const compactorInstances = [
      new ReadContentCompactor(),
      new EditCompactor(),
      new CreateCompactor(),
      new RenameCompactor(),
      new CopyCompactor(),
      new MoveCompactor(),
      new DeleteCompactor(),
      new ImageCompactor(),
      new SpeechCompactor(),
    ];
    for (const c of compactorInstances) {
      this.compactors.set(c.toolName, c);
    }
    this.registerModifyListener();
  }

  private registerModifyListener(): void {
    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', async (file: TFile) => {
        const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
        if (!file.path.startsWith(folderPath) || !file.path.endsWith('.md')) return;

        const title = this.plugin.conversationRenderer.extractTitleFromPath(file.path);

        try {
          const content = await this.plugin.app.vault.cachedRead(file);
          const saved = await this.store.pruneDeletedMessages(title, content);
          if (saved) {
            logger.log(
              `CompactionOrchestrator: pruned stw_compaction for "${title}" after message deletion`
            );
          }
        } catch (error) {
          logger.error(`CompactionOrchestrator: failed to prune compaction for "${title}"`, error);
        }
      })
    );
    logger.log('CompactionOrchestrator: registered modify listener for stw_compaction sync');
  }

  public async run(params: {
    conversationTitle: string;
    visibleWindowSize?: number;
    lang?: string | null;
    config?: Partial<CompactionConfig>;
  }): Promise<CompactionResult> {
    const config: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...params.config };
    if (!config.enabled) {
      return { data: await this.store.load(params.conversationTitle) };
    }

    const { conversationTitle } = params;
    const visibleWindowSize = params.visibleWindowSize ?? DEFAULT_VISIBLE_HISTORY_WINDOW;
    const { messageCount, outOfWindowMessages } = await this.getMessagesToCompact({
      conversationTitle,
      visibleWindowSize,
    });
    if (outOfWindowMessages.length === 0) {
      return { data: await this.store.load(conversationTitle) };
    }

    let data = await this.store.load(conversationTitle);
    const pending = getPendingOutOfWindowMessages({
      outOfWindowMessages,
      lastCompactedMessageId: data.lastCompactedMessageId,
    });
    if (pending.length === 0) {
      return {
        systemMessage: this.buildSystemMessage({
          data,
          recentWindowSize: visibleWindowSize,
          totalMessages: messageCount,
        }),
        data,
      };
    }

    data = await this.compactOutOfWindowMessages({
      conversationTitle,
      outOfWindowMessages: pending,
      data,
    });

    this.launchLongMessageSummaries({
      conversationTitle,
      data,
      lang: params.lang,
    });

    return {
      systemMessage: this.buildSystemMessage({
        data,
        recentWindowSize: visibleWindowSize,
        totalMessages: messageCount,
      }),
      data,
    };
  }

  private async getMessagesToCompact(params: {
    conversationTitle: string;
    visibleWindowSize: number;
  }): Promise<{ messageCount: number; outOfWindowMessages: ConversationMessage[] }> {
    const { conversationTitle, visibleWindowSize } = params;
    const allMessages = await this.renderer.extractAllConversationMessages(conversationTitle);
    const messagesForHistory = allMessages.filter(m => m.history !== false);
    if (
      messagesForHistory.length > 0 &&
      messagesForHistory[messagesForHistory.length - 1].role === 'user'
    ) {
      messagesForHistory.pop();
    }

    const messageCount = messagesForHistory.length;
    const groups = this.renderer.groupMessagesByStep(messagesForHistory);
    const messagesFromKeptGroups = this.filterGroupsToCompact(groups);
    const outOfWindowIds = new Set(
      messagesForHistory.slice(0, Math.max(0, messageCount - visibleWindowSize)).map(m => m.id)
    );
    const outOfWindowMessages = messagesFromKeptGroups.filter(m => outOfWindowIds.has(m.id));

    return {
      messageCount,
      outOfWindowMessages,
    };
  }

  private async compactOutOfWindowMessages(params: {
    conversationTitle: string;
    outOfWindowMessages: ConversationMessage[];
    data: CompactionData;
  }): Promise<CompactionData> {
    const { conversationTitle, outOfWindowMessages, data } = params;
    const newEntries: CompactedEntry[] = [];

    for (const message of outOfWindowMessages) {
      if (message.type === 'tool-invocation') {
        const alreadyProcessed = data.messages.some(
          e => e.type === 'tool' && e.messageId === message.id
        );
        if (alreadyProcessed) continue;

        const toolInvocations = await this.renderer.deserializeToolInvocations({
          message,
          conversationTitle,
        });
        if (toolInvocations) {
          for (const invocation of toolInvocations) {
            if (invocation.type !== 'tool-result') continue;
            const toolResult = invocation as ToolResultPart;
            if (!COMPACTABLE_TOOL_NAMES.has(toolResult.toolName)) continue;
            const compacted = this.compactToolResult(toolResult, message.id);
            newEntries.push({
              type: 'tool',
              messageId: message.id,
              toolName: compacted.toolName,
              metadata: compacted.metadata,
            });
          }
        }
        continue;
      }

      if (this.store.isCompacted(data, message.id)) continue;

      const rawContent = message.content.trim();
      const wordCount = countWords(rawContent);
      const shouldSummarize =
        isAssistantGenerated(message.role) && wordCount > SUMMARY_WORD_THRESHOLD;

      const entry: CompactedMessageEntry = {
        type: 'message',
        messageId: message.id,
        step: message.step,
        handlerId: message.handlerId,
        role: message.role,
        contentMode: 'original',
        content: rawContent,
        wordCount,
      };
      newEntries.push(entry);
      if (shouldSummarize) {
        this.summaryQueue.add(message.id);
      }
    }

    if (newEntries.length > 0) {
      this.store.mergeEntries(data, newEntries);
      const lastMsg = outOfWindowMessages[outOfWindowMessages.length - 1];
      if (lastMsg) {
        this.store.setBoundary(data, lastMsg.id, lastMsg.step);
      }
      await this.store.save(conversationTitle, data);
    }
    return data;
  }

  /**
   * Filters groups to those we should compact: user messages, assistant-only (no tools),
   * or groups that contain at least one compactable tool. Skips groups whose tools are
   * all non-compactable. Also filters out reasoning messages and tool-invocation messages
   * that contain only non-compactable tools (e.g. activate_tools).
   */
  private filterGroupsToCompact(groups: ConversationMessage[][]): ConversationMessage[] {
    const result: ConversationMessage[] = [];

    for (const group of groups) {
      const firstMessage = group[0];
      if (!firstMessage) continue;

      const toolInvocationMessages = group.filter(m => m.type === 'tool-invocation');
      const hasCompactableTool = toolInvocationMessages.some(msg => {
        const toolNames = this.renderer.extractToolNamesFromToolInvocation(msg.content);
        return toolNames.some(name => COMPACTABLE_TOOL_NAMES.has(name));
      });

      const isValidToolCall = toolInvocationMessages.some(msg => {
        return !msg.content.includes('AI_InvalidToolInputError');
      });

      const shouldKeepGroup =
        firstMessage.role === 'user' ||
        toolInvocationMessages.length === 0 ||
        (hasCompactableTool && isValidToolCall);

      if (!shouldKeepGroup) continue;

      const hasToolInvocation = toolInvocationMessages.length > 0;
      const filtered = hasToolInvocation
        ? group.filter(m => m.type === 'tool-invocation' && this.shouldIncludeMessage(m))
        : group.filter(m => this.shouldIncludeMessage(m));
      result.push(...filtered);
    }

    return result;
  }

  private shouldIncludeMessage(message: ConversationMessage): boolean {
    if (message.type === 'reasoning') return false;
    if (message.type === 'tool-invocation') {
      const toolNames = this.renderer.extractToolNamesFromToolInvocation(message.content);
      return toolNames.some(name => COMPACTABLE_TOOL_NAMES.has(name));
    }
    return true;
  }

  private resolveOutput(output: unknown): unknown {
    if (output && typeof output === 'object' && 'value' in output) {
      return (output as { value: unknown }).value;
    }
    return output;
  }

  private compactToolResult(toolResult: ToolResultPart, messageId: string): CompactedToolResult {
    const params: CompactorParams = {
      messageId,
      output: this.resolveOutput(toolResult.output),
    };
    const compactor = this.compactors.get(toolResult.toolName);
    if (!compactor) {
      return { toolName: toolResult.toolName, metadata: {} };
    }
    try {
      return compactor.compact(params);
    } catch (error) {
      logger.error(`CompactionOrchestrator: compactor failed for ${toolResult.toolName}`, error);
      return { toolName: toolResult.toolName, metadata: {} };
    }
  }

  private readonly summaryQueue = new Set<string>();

  private launchLongMessageSummaries(params: {
    conversationTitle: string;
    data: CompactionData;
    lang?: string | null;
  }): void {
    if (this.summaryQueue.size === 0) return;
    const messageIds = Array.from(this.summaryQueue);
    this.summaryQueue.clear();
    this.summarizeMessages({
      conversationTitle: params.conversationTitle,
      messageIds,
      lang: params.lang,
    }).catch((err: unknown) => {
      logger.error('CompactionOrchestrator: summary agent failed', err);
    });
  }

  private async summarizeMessages(params: {
    conversationTitle: string;
    messageIds: string[];
    lang?: string | null;
  }): Promise<void> {
    const data = await this.store.load(params.conversationTitle);
    const items: Array<{ messageId: string; content: string }> = [];
    const entryMap = new Map<string, CompactedMessageEntry>();

    for (const messageId of params.messageIds) {
      const entry = this.store.findMessageEntry(data, messageId);
      if (!entry || entry.type !== 'message') continue;
      const msg = entry;
      if (!isAssistantGenerated(msg.role)) continue;
      if (msg.wordCount <= SUMMARY_WORD_THRESHOLD) continue;
      if (msg.contentMode === 'summarized' || msg.contentMode === 'deleted') continue;

      items.push({ messageId: msg.messageId, content: msg.content });
      entryMap.set(msg.messageId, msg);
    }

    if (items.length === 0) return;

    const results = await this.summaryAgent.summarizeMessagesBatch({
      items,
      lang: params.lang,
    });

    for (const r of results) {
      const entry = entryMap.get(r.messageId);
      if (!entry) continue;
      if (r.type === 'summarized') {
        entry.content = r.text.trim() || entry.content;
        entry.contentMode = 'summarized';
      } else {
        entry.content = '[deleted]';
        entry.contentMode = 'deleted';
      }
    }

    await this.store.save(params.conversationTitle, data);
  }

  private buildSystemMessage(params: {
    data: CompactionData;
    recentWindowSize: number;
    totalMessages: number;
  }): string {
    const { data, recentWindowSize, totalMessages } = params;
    const entries = data.messages ?? [];
    const count = entries.length;

    const lines: string[] = [
      'COMPACTED CONVERSATION CONTEXT',
      '',
      `Policy: The most recent ${recentWindowSize} messages (of ${totalMessages} total) are included as raw context. ${count} earlier entries have been compacted below.`,
      '',
      'IMPORTANT: Always use recall_compacted_context with messageIds from the index to retrieve full content when needed. DO NOT guess or make up information—base your response only on retrieved content.',
      '',
      'Format: <role> (<messageId>, <type>): <preview>. Example: User (msg-abc123, original): Hello | Assistant (msg-xyz789, original): Detailed explanation | Assistant (msg-abc124, summarized): Concise summary | Assistant (msg-def456, compacted): [content_reading] {...}',
      '',
    ];

    if (entries.length === 0) {
      return lines.join('\n');
    }

    lines.push('Compacted context:');
    const separator = '\n---\n';
    const entryLines: string[] = [];
    for (const entry of entries) {
      const contentModeLabel =
        entry.type === 'tool' ? 'compacted' : (entry as CompactedMessageEntry).contentMode;
      const displayId = `msg-${entry.messageId}`;
      const prefix = `(${displayId}, ${contentModeLabel})`;

      if (entry.type === 'message') {
        const label = entry.role === 'user' ? 'User' : 'Assistant';
        entryLines.push(`${label} ${prefix}: ${entry.content}`);
      } else {
        const metaStr = JSON.stringify(entry.metadata);
        entryLines.push(`Assistant ${prefix}: [${entry.toolName}] ${metaStr}`);
      }
    }
    lines.push(entryLines.join(separator));

    return lines.join('\n');
  }
}
