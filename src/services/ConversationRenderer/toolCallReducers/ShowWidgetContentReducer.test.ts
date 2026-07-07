import { ShowWidgetContentReducer } from './ShowWidgetContentReducer';
import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import type { ShowWidgetArgs } from 'src/solutions/commands/agents/handlers/ShowWidget';

function createToolCall(input: ShowWidgetArgs): ToolCallPart<ShowWidgetArgs> {
  return {
    type: 'tool-call',
    toolCallId: 'test-call-id',
    toolName: ToolName.SHOW_WIDGET,
    input,
  } as ToolCallPart<ShowWidgetArgs>;
}

describe('ShowWidgetContentReducer', () => {
  let reducer: ShowWidgetContentReducer;

  beforeEach(() => {
    reducer = new ShowWidgetContentReducer();
  });

  it('replaces code with a recall_compacted_context placeholder for code-mode widgets', () => {
    const toolCall = createToolCall({
      type: 'html',
      widgetName: 'My Widget',
      code: '<html>very long widget markup</html>',
    } as ShowWidgetArgs);

    const reduced = reducer.reduceToolCall({ toolCall, messageId: 'abc123', lang: 'en' });

    const input = reduced.input as ShowWidgetArgs;
    expect(input.code).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
    expect(input.code).toContain('msg-abc123');
  });

  it('leaves code-mode toolCall unchanged when code is empty', () => {
    const toolCall = createToolCall({
      type: 'html',
      widgetName: 'My Widget',
      code: '',
    } as ShowWidgetArgs);

    const reduced = reducer.reduceToolCall({ toolCall, messageId: 'abc123', lang: 'en' });

    expect(reduced).toBe(toolCall);
  });

  it('replaces file content with a content_reading placeholder for project-mode widgets', () => {
    const toolCall = createToolCall({
      type: 'html',
      widgetName: 'My Widget',
      files: [
        { name: 'index.html', content: '<html>long</html>' },
        { name: 'style.css', content: 'body { color: red; }' },
      ],
    } as ShowWidgetArgs);

    const reduced = reducer.reduceToolCall({ toolCall, messageId: 'abc123', lang: 'en' });

    const input = reduced.input as ShowWidgetArgs;
    expect(input.files).toHaveLength(2);
    for (const file of input.files ?? []) {
      expect(file.content).toContain(ToolName.CONTENT_READING);
    }
  });

  it('does not mutate the original toolCall input', () => {
    const originalCode = '<html>original</html>';
    const toolCall = createToolCall({
      type: 'html',
      widgetName: 'My Widget',
      code: originalCode,
    } as ShowWidgetArgs);

    reducer.reduceToolCall({ toolCall, messageId: 'abc123', lang: 'en' });

    expect(toolCall.input.code).toBe(originalCode);
  });
});
