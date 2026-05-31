import { ToolName } from 'src/solutions/commands/toolNames';
import type { RecallCompactedContextResult } from 'src/solutions/commands/agents/handlers/RecallCompactedContext';
import type { ToolResultCompactor, CompactedToolResult, CompactorParams } from '../types';
import { measureSerializedOutputSize } from './outputMetrics';

const MSG_PREFIX = 'msg-';
/** Recall payloads above this size should be processed in the next turn before more tools. */
export const LARGE_RECALL_OUTPUT_CHARS = 6_000;
const NEAR_BATCH_END_ENTRIES = 2;

function normalizeRecallMessageIds(messageIds?: string[]): string[] {
  if (!messageIds?.length) {
    return [];
  }
  const normalized: string[] = [];
  for (const id of messageIds) {
    normalized.push(id.startsWith(MSG_PREFIX) ? id.slice(MSG_PREFIX.length) : id);
  }
  return normalized;
}

function parseRecallOutput(output: unknown): RecallCompactedContextResult | null {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as RecallCompactedContextResult;
    } catch {
      return null;
    }
  }
  if (!output || typeof output !== 'object' || !('messages' in output)) {
    return null;
  }
  return output as RecallCompactedContextResult;
}

function buildRecallGuidance(params: {
  outputSize: number;
  requestedIds: string[];
  missingMessageIds: string[];
  compactionBatch?: CompactionBatchContextFromParams;
}): string[] {
  const guidance: string[] = [];
  const batch = params.compactionBatch;

  if (params.missingMessageIds.length > 0) {
    guidance.push(
      `Some messageIds were not found: ${params.missingMessageIds.join(', ')}. Check ids in the compacted index.`
    );
  }

  const overlapIds =
    batch && params.requestedIds.length > 0
      ? params.requestedIds.filter(id => batch.batchMessageIds.has(id))
      : [];
  if (overlapIds.length > 0) {
    guidance.push(
      'Recalled messageIds overlap messages or tool results being compacted in this pass; the full recall payload is omitted here. Use smaller messageId batches or recall again after compaction if you still need details.'
    );
  }

  const isLarge = params.outputSize >= LARGE_RECALL_OUTPUT_CHARS;
  if (isLarge) {
    guidance.push(
      `Recalled content is large (${params.outputSize} chars). Process and apply it in your next reply before calling more tools.`
    );
  }

  const nearBatchEnd =
    batch &&
    batch.entryCount > 0 &&
    batch.entryIndex >= batch.entryCount - NEAR_BATCH_END_ENTRIES;
  if (nearBatchEnd && (isLarge || overlapIds.length > 0)) {
    guidance.push(
      'This recall ran near the end of the history window that is being compacted; treat the recalled payload as time-sensitive and process it immediately in your next turn.'
    );
  }

  return guidance;
}

type CompactionBatchContextFromParams = NonNullable<CompactorParams['compactionBatch']>;

/**
 * Compactor for recall_compacted_context tool results.
 * Omits bulky message payloads while preserving recall stats and next-turn guidance.
 */
export class RecallCompactedContextCompactor implements ToolResultCompactor {
  readonly toolName = ToolName.RECALL_COMPACTED_CONTEXT;

  compact(params: CompactorParams): CompactedToolResult {
    const parsed = parseRecallOutput(params.output);
    const outputSize = measureSerializedOutputSize(params.output);
    const recallInput = params.toolCall.input as { messageIds?: string[] } | undefined;
    const requestedIds = normalizeRecallMessageIds(recallInput?.messageIds);
    const missingMessageIds = parsed?.missingMessageIds ?? [];
    const recalledMessageCount = parsed?.messages?.length ?? 0;
    const guidance = buildRecallGuidance({
      outputSize,
      requestedIds,
      missingMessageIds,
      compactionBatch: params.compactionBatch,
    });

    return {
      toolName: this.toolName,
      metadata: {
        input: { messageIds: requestedIds },
        recalledMessageCount,
        ...(missingMessageIds.length > 0 && { missingMessageIds }),
        ...(guidance.length > 0 && { guidance }),
        output: `Output omitted. Use ${ToolName.RECALL_COMPACTED_CONTEXT} to retrieve the full tool result.`,
      },
    };
  }
}
