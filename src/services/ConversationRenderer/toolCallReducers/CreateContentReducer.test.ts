import { CreateContentReducer } from './CreateContentReducer';
import { ToolName } from 'src/solutions/commands/toolNames';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import type { CreateToolArgs } from 'src/solutions/commands/agents/handlers/VaultCreate';

function createToolCall(input: CreateToolArgs): ToolCallPart<CreateToolArgs> {
  return {
    type: 'tool-call',
    toolCallId: 'test-call-id',
    toolName: ToolName.CREATE,
    input,
  } as ToolCallPart<CreateToolArgs>;
}

describe('CreateContentReducer', () => {
  let reducer: CreateContentReducer;

  beforeEach(() => {
    reducer = new CreateContentReducer();
  });

  it('replaces file content with an omitted-content placeholder', () => {
    const toolCall = createToolCall({
      newFolders: [],
      newFiles: [{ filePath: 'notes/note1.md', content: 'This is a long note content' }],
    });

    const reduced = reducer.reduceToolCall({ toolCall, messageId: 'msg-1', lang: 'en' });

    const newFiles = (reduced.input as CreateToolArgs).newFiles;
    expect(newFiles).toHaveLength(1);
    expect(newFiles[0].filePath).toBe('notes/note1.md');
    expect(newFiles[0].content).toContain(ToolName.CONTENT_READING);
  });

  it('keeps content undefined for files without content', () => {
    const toolCall = createToolCall({
      newFolders: [],
      newFiles: [{ filePath: 'notes/empty.md' }],
    });

    const reduced = reducer.reduceToolCall({ toolCall, messageId: 'msg-1', lang: 'en' });

    expect((reduced.input as CreateToolArgs).newFiles).toMatchObject([
      { filePath: 'notes/empty.md', content: undefined },
    ]);
  });

  it('handles mixed files with and without content', () => {
    const toolCall = createToolCall({
      newFolders: ['project/assets'],
      newFiles: [
        { filePath: 'project/readme.md', content: '# Project\nLong description here...' },
        { filePath: 'project/empty.md' },
        { filePath: 'project/config.base', content: 'key: value' },
      ],
    });

    const reduced = reducer.reduceToolCall({ toolCall, messageId: 'msg-1', lang: 'en' });

    const newFiles = (reduced.input as CreateToolArgs).newFiles;
    expect(newFiles).toHaveLength(3);
    expect(newFiles[0].filePath).toBe('project/readme.md');
    expect(newFiles[0].content).toContain(ToolName.CONTENT_READING);
    expect(newFiles[1].filePath).toBe('project/empty.md');
    expect(newFiles[1].content).toBeUndefined();
    expect(newFiles[2].filePath).toBe('project/config.base');
    expect(newFiles[2].content).toContain(ToolName.CONTENT_READING);
  });

  it('does not mutate the original toolCall input', () => {
    const originalContent = 'This content should remain unchanged on the original object';
    const toolCall = createToolCall({
      newFolders: [],
      newFiles: [{ filePath: 'notes/note.md', content: originalContent }],
    });

    reducer.reduceToolCall({ toolCall, messageId: 'msg-1', lang: 'en' });

    expect(toolCall.input.newFiles[0].content).toBe(originalContent);
  });
});
