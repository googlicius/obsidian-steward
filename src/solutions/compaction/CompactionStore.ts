import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { logger } from 'src/utils/logger';
import {
  COMPACTION_SCHEMA_VERSION,
  type CompactionData,
  type CompactedEntry,
  type CompactedMessageEntry,
} from './types';

const FRONTMATTER_KEY = 'stw_compaction';

function createEmptyCompactionData(): CompactionData {
  return {
    version: COMPACTION_SCHEMA_VERSION,
    messages: [],
  };
}

/**
 * Reads and writes compaction data from/to conversation frontmatter.
 */
export class CompactionStore {
  constructor(private readonly renderer: ConversationRenderer) {}

  public async load(conversationTitle: string): Promise<CompactionData> {
    const raw = await this.renderer.getConversationProperty<CompactionData>(
      conversationTitle,
      FRONTMATTER_KEY
    );

    if (!raw || raw.version !== COMPACTION_SCHEMA_VERSION) {
      return createEmptyCompactionData();
    }

    const data = { ...createEmptyCompactionData(), ...raw };
    if (!Array.isArray(data.messages)) {
      data.messages = [];
    }
    return data;
  }

  public async save(conversationTitle: string, data: CompactionData): Promise<boolean> {
    try {
      return await this.renderer.updateConversationFrontmatter(conversationTitle, [
        { name: FRONTMATTER_KEY, value: data },
      ]);
    } catch (error) {
      logger.error('CompactionStore: failed to save compaction data', error);
      return false;
    }
  }

  /**
   * Append new entries to the messages array.
   * Skips message entries that already exist (by messageId); tool entries are always appended.
   */
  public mergeEntries(
    data: CompactionData,
    entries: CompactedEntry[],
    overwrite = false
  ): CompactionData {
    const existingMessageIds = new Set(
      data.messages.filter(e => e.type === 'message').map(e => e.messageId)
    );
    for (const entry of entries) {
      if (entry.type === 'message' && !overwrite && existingMessageIds.has(entry.messageId)) {
        continue;
      }
      if (entry.type === 'message') {
        existingMessageIds.add(entry.messageId);
      }
      data.messages.push(entry);
    }
    return data;
  }

  public setBoundary(
    data: CompactionData,
    lastMessageId: string,
    lastStep?: number
  ): CompactionData {
    data.lastCompactedMessageId = lastMessageId;
    data.lastCompactedStep = lastStep;
    data.compactedAt = Date.now();
    return data;
  }

  /**
   * Check whether a messageId has already been compacted (as message or tool entry).
   */
  public isCompacted(data: CompactionData, messageId: string): boolean {
    return data.messages.some(e => e.messageId === messageId);
  }

  /**
   * Find a message entry by messageId (for summary agent updates).
   */
  public findMessageEntry(
    data: CompactionData,
    messageId: string
  ): CompactedMessageEntry | undefined {
    const entry = data.messages.find(e => e.type === 'message' && e.messageId === messageId);
    return entry?.type === 'message' ? entry : undefined;
  }

  /**
   * Prune compaction entries for message IDs that no longer exist in the conversation content.
   * Called when messages are deleted (e.g. via deleteMessageAndBelow) to keep compaction in sync.
   * @param conversationTitle The title of the conversation
   * @param content The current file content (after deletion)
   * @returns True if data was changed and saved
   */
  public async pruneDeletedMessages(
    conversationTitle: string,
    content: string
  ): Promise<boolean> {
    const data = await this.load(conversationTitle);
    if (data.messages.length === 0) return false;

    const existingIds = this.renderer.extractMessageIdsFromContent(content);
    const originalLength = data.messages.length;
    data.messages = data.messages.filter(e => existingIds.has(e.messageId));

    if (data.messages.length === originalLength) return false;

    if (
      data.lastCompactedMessageId &&
      !existingIds.has(data.lastCompactedMessageId)
    ) {
      const lastEntry = data.messages[data.messages.length - 1];
      data.lastCompactedMessageId = lastEntry?.messageId;
      data.lastCompactedStep = lastEntry?.type === 'message' ? lastEntry.step : undefined;
    }

    return this.save(conversationTitle, data);
  }
}
