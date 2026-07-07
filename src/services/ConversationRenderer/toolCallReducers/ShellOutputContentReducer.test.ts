import { ShellOutputContentReducer } from './ShellOutputContentReducer';
import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolResultPart } from 'src/solutions/commands/tools/types';

function createToolResult(output: unknown): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: 'test-call-id',
    toolName: ToolName.SHELL,
    output,
  } as ToolResultPart;
}

describe('ShellOutputContentReducer', () => {
  let reducer: ShellOutputContentReducer;

  beforeEach(() => {
    reducer = new ShellOutputContentReducer();
  });

  it('replaces output over 100 lines with a recall_compacted_context placeholder', () => {
    const longOutput = Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n');
    const toolResult = createToolResult({ type: 'text', value: longOutput });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'shell_msg_1',
      lang: 'en',
    });

    const output = reduced.output as { type: string; value: string };
    expect(output.value).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
    expect(output.value).toContain('msg-shell_msg_1');
    expect(output.value).toContain('150 lines');
  });

  it('leaves output at exactly 100 lines unchanged', () => {
    const output100 = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const toolResult = createToolResult({ type: 'text', value: output100 });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'shell_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('leaves short output unchanged', () => {
    const toolResult = createToolResult({ type: 'text', value: 'short output\nline 2' });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'shell_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('leaves non-text output (e.g. error-text) unchanged regardless of length', () => {
    const longOutput = Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n');
    const toolResult = createToolResult({ type: 'error-text', value: longOutput });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'shell_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('leaves execution-denied output unchanged', () => {
    const toolResult = createToolResult({ type: 'execution-denied' });

    const reduced = reducer.reduceToolResult({
      toolResult,
      messageId: 'shell_msg_1',
      lang: 'en',
    });

    expect(reduced).toBe(toolResult);
  });

  it('does not mutate the original toolResult', () => {
    const longOutput = Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n');
    const toolResult = createToolResult({ type: 'text', value: longOutput });

    reducer.reduceToolResult({ toolResult, messageId: 'shell_msg_1', lang: 'en' });

    expect((toolResult.output as { value: string }).value).toBe(longOutput);
  });
});
