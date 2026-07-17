import { WidgetQueryResultReducer } from './WidgetQueryResultReducer';
import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultPart } from 'src/solutions/commands/tools/types';

function createToolResult(output: unknown): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: 'test-call-id',
    toolName: ToolName.WIDGET_QUERY,
    output,
  } as ToolResultPart;
}

describe('WidgetQueryResultReducer', () => {
  let reducer: WidgetQueryResultReducer;

  beforeEach(() => {
    reducer = new WidgetQueryResultReducer();
  });

  it('replaces a large json result with a recall_compacted_context placeholder', () => {
    const largeValue = { board: Array.from({ length: 100 }, (_, i) => ({ index: i, mark: 'x' })) };
    const toolResult = createToolResult({ type: 'json', value: largeValue });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'widget_msg_1',
      lang: 'en',
    });

    const output = reduced.output as { type: string; value: string };
    expect(output.type).toBe('text');
    expect(output.value).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
    expect(output.value).toContain('msg-widget_msg_1');
  });

  it('replaces a large text result with a placeholder', () => {
    const toolResult = createToolResult({ type: 'text', value: 'x'.repeat(500) });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'widget_msg_1',
      lang: 'en',
    });

    const output = reduced.output as { type: string; value: string };
    expect(output.value).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
  });

  it('leaves a small json result unchanged (never grows output)', () => {
    const toolResult = createToolResult({ type: 'json', value: { ok: true } });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'widget_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('leaves error-text output unchanged regardless of length', () => {
    const toolResult = createToolResult({ type: 'error-text', value: 'x'.repeat(500) });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'widget_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('leaves execution-denied output unchanged', () => {
    const toolResult = createToolResult({ type: 'execution-denied' });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'widget_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('does not mutate the original toolResult', () => {
    const largeValue = { board: Array.from({ length: 100 }, (_, i) => ({ index: i, mark: 'x' })) };
    const toolResult = createToolResult({ type: 'json', value: largeValue });

    reducer.reduceToolResult({ toolResult, messageId: 'widget_msg_1', lang: 'en' });

    expect((toolResult.output as { value: unknown }).value).toEqual(largeValue);
  });
});
