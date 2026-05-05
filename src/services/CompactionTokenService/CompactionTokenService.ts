import type { ModelMessage } from 'ai';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events, type ExecutedStreamTextPayload } from 'src/types/events';
import type { ToolCallPart, ToolResultPart } from 'src/solutions/commands/tools/types';
import { ToolName } from 'src/solutions/commands/toolNames';
import { CompactionSummaryAgent } from 'src/solutions/commands/agents/CompactionSummaryAgent/CompactionSummaryAgent';
import type {
  CompactedEntry,
  CompactedMessageEntry,
  CompactedToolResult,
  ToolResultCompactor,
  CompactorParams,
  CompactionData,
} from './types';
import {
  CopyCompactor,
  CreateCompactor,
  DeleteCompactor,
  EditCompactor,
  ImageCompactor,
  MoveCompactor,
  ReadContentCompactor,
  RenameCompactor,
  ShellCompactor,
  SpeechCompactor,
} from './compactors';

export const COMPACTION_PROMPT_THRESHOLD_PERCENT = 0.8;
const SUMMARY_WORD_THRESHOLD = 50;
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
  ToolName.SHELL,
]);

export function estimatePromptTokensRoughFromMessages(messages: ModelMessage[]): number {
  if (!messages.length) {
    return 0;
  }
  const chars = JSON.stringify(messages).length;
  return Math.ceil(chars / 4);
}

export class CompactionTokenService {
  private readonly summaryAgent: CompactionSummaryAgent;
  private readonly compactors: Map<string, ToolResultCompactor>;
  private readonly pendingCompactions = new Set<string>();

  constructor(private readonly plugin: StewardPlugin) {
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
      new ShellCompactor(),
    ];
    for (const compactor of compactorInstances) {
      this.compactors.set(compactor.toolName, compactor);
    }

    eventEmitter.on(Events.EXECUTED_STREAM_TEXT, payload => {
      void this.handleExecutedStreamText(payload);
    });
  }

  private shouldTriggerCompactionByTokens(params: {
    promptTokens: number;
    contextLength: number;
    thresholdPercent: number;
  }): boolean {
    const { promptTokens, contextLength, thresholdPercent } = params;
    if (
      !Number.isFinite(promptTokens) ||
      !Number.isFinite(contextLength) ||
      contextLength <= 0 ||
      !Number.isFinite(thresholdPercent)
    ) {
      return false;
    }
    const pct = Math.min(1, Math.max(0, thresholdPercent));
    const threshold = contextLength * pct;
    return promptTokens >= threshold;
  }

  private async handleExecutedStreamText(payload: ExecutedStreamTextPayload): Promise<void> {
    const key = payload.conversationTitle;
    if (this.pendingCompactions.has(key)) {
      return;
    }
    this.pendingCompactions.add(key);
    try {
      const shouldRun = await this.shouldRunCompaction(payload);
      if (!shouldRun) {
        return;
      }
      await this.compactConversation(payload);
    } catch (error) {
      logger.error('CompactionTokenService: compaction failed', error);
    } finally {
      this.pendingCompactions.delete(key);
    }
  }

  private async shouldRunCompaction(payload: ExecutedStreamTextPayload): Promise<boolean> {
    const promptTokens =
      payload.promptTokens ??
      (await this.plugin.conversationRenderer.getRecordedInputTokensForAgent(
        payload.conversationTitle,
        'super'
      ));
    if (promptTokens === undefined) {
      logger.warn(`No promptTokens in the ${payload.conversationTitle}`);
      return false;
    }
    const contextLength = this.plugin.llmService.getModelContextLengthTokens(payload.model);
    return this.shouldTriggerCompactionByTokens({
      promptTokens,
      contextLength,
      thresholdPercent: COMPACTION_PROMPT_THRESHOLD_PERCENT,
    });
  }

  private async compactConversation(payload: ExecutedStreamTextPayload): Promise<void> {
    const messages = await this.plugin.conversationRenderer.getMessagesForCompaction(
      payload.conversationTitle
    );
    if (!messages.length) {
      return;
    }

    const entries: CompactedEntry[] = [];
    const summarizeQueue: Array<{ messageId: string; content: string }> = [];
    for (const item of messages) {
      if (item.type === 'tool') {
        if (!COMPACTABLE_TOOL_NAMES.has(item.toolName)) {
          continue;
        }
        const compacted = this.compactToolResult(
          item.toolResult,
          item.messageId,
          item.toolCall
        );
        entries.push({
          type: 'tool',
          messageId: item.messageId,
          toolName: compacted.toolName,
          metadata: compacted.metadata,
        });
        continue;
      }
      const content = item.content.trim();
      if (!content) {
        continue;
      }
      const entry: CompactedMessageEntry = {
        type: 'message',
        messageId: item.messageId,
        step: item.step,
        handlerId: item.handlerId,
        role: item.role,
        contentMode: 'original',
        content,
        wordCount: item.wordCount,
      };
      entries.push(entry);
      if (item.role === 'assistant') {
        if (item.wordCount > SUMMARY_WORD_THRESHOLD) {
          summarizeQueue.push({
            messageId: item.messageId,
            content: item.content,
          });
        } else {
          logger.warn(`This message is considered as too short to summarize`, {
            message: item,
          });
        }
      }
    }
    if (!entries.length) {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    const data: CompactionData = {
      messages: entries,
      lastCompactedMessageId: lastMessage?.messageId,
      lastCompactedStep: lastMessage?.type === 'message' ? lastMessage.step : undefined,
      compactedAt: Date.now(),
    };
    await this.applySummaries({
      conversationTitle: payload.conversationTitle,
      lang: payload.lang,
      data,
      queue: summarizeQueue,
    });

    const compactedCount = await this.plugin.conversationRenderer.countCompactedMessageBlocks(
      payload.conversationTitle
    );
    const compactIndex = compactedCount + 1;
    const compactedText = this.buildCompactedMessage(data, { compactIndex });
    await this.plugin.conversationRenderer.updateConversationNote({
      path: payload.conversationTitle,
      newContent: compactedText,
      includeHistory: true,
      agent: 'compaction',
      command: 'compacted',
    });
  }

  private async applySummaries(params: {
    conversationTitle: string;
    lang?: string | null;
    data: CompactionData;
    queue: Array<{ messageId: string; content: string }>;
  }): Promise<void> {
    if (!params.queue.length) {
      return;
    }
    const summarized = await this.summaryAgent.summarizeMessagesBatch({
      conversationTitle: params.conversationTitle,
      items: params.queue,
      lang: params.lang,
    });
    if (!summarized.length) {
      return;
    }
    const byId = new Map(summarized.map(item => [item.messageId, item]));
    for (const entry of params.data.messages) {
      if (entry.type !== 'message') {
        continue;
      }
      const result = byId.get(entry.messageId);
      if (!result) {
        continue;
      }
      if (result.type === 'summarized') {
        entry.contentMode = 'summarized';
        entry.content = result.text.trim() || entry.content;
        continue;
      }
      entry.contentMode = 'deleted';
      entry.content = '[deleted]';
    }
  }

  private compactToolResult(
    toolResult: ToolResultPart,
    messageId: string,
    toolCall: ToolCallPart
  ): CompactedToolResult {
    const compactor = this.compactors.get(toolResult.toolName);
    if (!compactor) {
      return { toolName: toolResult.toolName, metadata: {} };
    }
    const params: CompactorParams = {
      messageId,
      output: this.resolveOutput(toolResult.output),
      toolCall,
    };
    try {
      return compactor.compact(params);
    } catch (error) {
      logger.error(`CompactionTokenService: compactor failed for ${toolResult.toolName}`, error);
      return { toolName: toolResult.toolName, metadata: {} };
    }
  }

  private resolveOutput(output: unknown): unknown {
    if (!output || typeof output !== 'object' || !('value' in output)) {
      return output;
    }
    return (output as { value: unknown }).value;
  }

  private buildCompactedMessage(data: CompactionData, params: { compactIndex: number }): string {
    const compactLabel = `Compact #${params.compactIndex}`;
    const lines: string[] = [];
    if (params.compactIndex === 1) {
      lines.push(
        'COMPACTED CONVERSATION CONTEXT',
        '',
        `IMPORTANT: Always use ${ToolName.RECALL_COMPACTED_CONTEXT} with messageIds from the index to retrieve full content when needed.`,
        '',
        'Format: <role> (<messageId>, <type>): <preview>',
        '',
        compactLabel,
        '',
        'Compacted context:'
      );
    } else {
      lines.push(compactLabel, '', 'Compacted context:');
    }
    for (const entry of data.messages) {
      const displayId = `msg-${entry.messageId}`;
      if (entry.type === 'message') {
        const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';
        lines.push(`\n${roleLabel} (${displayId}, ${entry.contentMode}): ${entry.content}`);
        continue;
      }
      lines.push(
        `\nAssistant (${displayId}, compacted): [${entry.toolName}] ${JSON.stringify(entry.metadata)}`
      );
    }
    const compactedContent = lines.join('\n').replace(/```/g, '\\`\\`\\`');
    return `\`\`\`stw-hidden-from-user\n${compactedContent}\n\`\`\``;
  }
}
