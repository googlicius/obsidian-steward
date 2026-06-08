import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import {
  LARGE_RECALL_OUTPUT_CHARS,
  RecallCompactedContextCompactor,
} from './RecallCompactedContextCompactor';

describe('RecallCompactedContextCompactor', () => {
  const compactor = new RecallCompactedContextCompactor();

  it('omits payload and records recall stats', () => {
    const output = JSON.stringify({
      messages: [{ role: 'user', content: 'Hello' }],
      missingMessageIds: [],
    });
    const toolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.RECALL_COMPACTED_CONTEXT,
      toolCallId: 'call_recall',
      input: { messageIds: ['msg-abc'] },
    } satisfies ToolCallPart;

    const result = compactor.compact({
      messageId: 'msg1',
      output,
      toolCall,
    });

    expect(result.metadata.input).toEqual({ messageIds: ['abc'] });
    expect(result.metadata.recalledMessageCount).toBe(1);
    expect(String(result.metadata.output)).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
  });

  it('adds guidance when output is large', () => {
    const largeContent = 'x'.repeat(LARGE_RECALL_OUTPUT_CHARS);
    const output = JSON.stringify({
      messages: [{ role: 'user', content: largeContent }],
      missingMessageIds: [],
    });
    const toolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.RECALL_COMPACTED_CONTEXT,
      toolCallId: 'call_recall',
      input: { messageIds: ['a'] },
    } satisfies ToolCallPart;

    const result = compactor.compact({
      messageId: 'msg1',
      output,
      toolCall,
    });

    const guidance = result.metadata.guidance as string[];
    expect(guidance.some(line => line.includes('large'))).toBe(true);
    expect(guidance.some(line => line.includes('next reply'))).toBe(true);
  });

  it('adds overlap and near-end guidance when batch context matches', () => {
    const output = JSON.stringify({
      messages: [{ role: 'user', content: 'y'.repeat(LARGE_RECALL_OUTPUT_CHARS) }],
      missingMessageIds: [],
    });
    const toolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.RECALL_COMPACTED_CONTEXT,
      toolCallId: 'call_recall',
      input: { messageIds: ['target-id'] },
    } satisfies ToolCallPart;

    const result = compactor.compact({
      messageId: 'msg-recall',
      output,
      toolCall,
      compactionBatch: {
        batchMessageIds: new Set(['target-id', 'msg-recall']),
        entryIndex: 1,
        entryCount: 2,
      },
    });

    const guidance = result.metadata.guidance as string[];
    expect(guidance.some(line => line.includes('overlap'))).toBe(true);
    expect(guidance.some(line => line.includes('time-sensitive'))).toBe(true);
  });

  it('reports missing messageIds', () => {
    const output = JSON.stringify({
      messages: [],
      missingMessageIds: ['gone'],
    });
    const toolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.RECALL_COMPACTED_CONTEXT,
      toolCallId: 'call_recall',
      input: { messageIds: ['gone'] },
    } satisfies ToolCallPart;

    const result = compactor.compact({
      messageId: 'msg1',
      output,
      toolCall,
    });

    expect(result.metadata.missingMessageIds).toEqual(['gone']);
    const guidance = result.metadata.guidance as string[];
    expect(guidance.some(line => line.includes('not found'))).toBe(true);
  });
});
