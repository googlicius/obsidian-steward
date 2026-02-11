import { createToolSchema, VaultCreate, type CreateToolArgs } from './VaultCreate';
import { type SuperAgent } from '../SuperAgent';
import { type ToolCallPart } from '../../tools/types';

function createMockAgent(): jest.Mocked<SuperAgent> {
  return {
    app: {
      vault: {
        create: jest.fn().mockResolvedValue(undefined),
        getFileByPath: jest.fn().mockReturnValue({ path: 'mock' }),
        modify: jest.fn().mockResolvedValue(undefined),
      },
    },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
    },
    renderer: {
      updateConversationNote: jest.fn().mockResolvedValue('mock-message-id'),
      serializeToolInvocation: jest.fn().mockResolvedValue(undefined),
    },
    plugin: {
      artifactManagerV2: {
        withTitle: jest.fn().mockReturnValue({
          storeArtifact: jest.fn().mockResolvedValue('mock-artifact-id'),
        }),
      },
    },
  } as unknown as jest.Mocked<SuperAgent>;
}

function createToolCall(input: CreateToolArgs): ToolCallPart<CreateToolArgs> {
  return {
    type: 'tool-call',
    toolCallId: 'test-call-id',
    toolName: 'vault_create',
    input,
  } as ToolCallPart<CreateToolArgs>;
}

describe('VaultCreate', () => {
  describe('createToolSchema', () => {
    it('should extract YAML from a code block for .base files', () => {
      const input = {
        folder: 'my-folder',
        newFiles: [
          {
            fileName: 'config.base',
            content: '```yaml\nkey: value\nnested:\n  foo: bar\n```',
          },
        ],
      };

      const result = createToolSchema.parse(input);

      expect(result.newFiles[0].content).toBe('key: value\nnested:\n  foo: bar');
    });

    it('should extract YAML from a code block with case-insensitive tag', () => {
      const input = {
        folder: 'my-folder',
        newFiles: [
          {
            fileName: 'config.base',
            content: '```YAML\ntitle: Hello\n```',
          },
        ],
      };

      const result = createToolSchema.parse(input);

      expect(result.newFiles[0].content).toBe('title: Hello');
    });

    it('should leave .base content unchanged when no code block is present', () => {
      const input = {
        folder: 'my-folder',
        newFiles: [
          {
            fileName: 'config.base',
            content: 'key: value\nnested:\n  foo: bar',
          },
        ],
      };

      const result = createToolSchema.parse(input);

      expect(result.newFiles[0].content).toBe('key: value\nnested:\n  foo: bar');
    });

    it('should not transform content for non-.base files', () => {
      const input = {
        folder: 'my-folder',
        newFiles: [
          {
            fileName: 'readme.md',
            content: '```yaml\nkey: value\n```',
          },
        ],
      };

      const result = createToolSchema.parse(input);

      expect(result.newFiles[0].content).toBe('```yaml\nkey: value\n```');
    });

    it('should not transform .base content when it is undefined', () => {
      const input = {
        folder: 'my-folder',
        newFiles: [
          {
            fileName: 'empty.base',
          },
        ],
      };

      const result = createToolSchema.parse(input);

      expect(result.newFiles[0].content).toBeUndefined();
    });

    it('should handle .base content with surrounding whitespace around the code block', () => {
      const input = {
        folder: 'my-folder',
        newFiles: [
          {
            fileName: 'config.base',
            content: '  \n```yaml\nstatus: active\n```\n  ',
          },
        ],
      };

      const result = createToolSchema.parse(input);

      expect(result.newFiles[0].content).toBe('status: active');
    });
  });

  describe('executeCreatePlan', () => {
    let mockAgent: jest.Mocked<SuperAgent>;
    let vaultCreate: VaultCreate;

    beforeEach(() => {
      mockAgent = createMockAgent();
      vaultCreate = new VaultCreate(mockAgent);
    });

    it('should replace file content with omitted message in serialized tool invocation', async () => {
      const toolCall = createToolCall({
        folder: 'notes',
        newFiles: [
          { fileName: 'note1.md', content: 'This is a long note content that should be omitted' },
        ],
      });

      await vaultCreate.executeCreatePlan({
        title: 'test-conversation',
        plan: { folder: 'notes', newFiles: [{ fileName: 'note1.md', content: 'Some content' }] },
        lang: 'en',
        handlerId: 'handler-1',
        toolCall,
      });

      const serializeCall = mockAgent.renderer.serializeToolInvocation as jest.Mock;
      expect(serializeCall).toHaveBeenCalledTimes(1);

      const serializedArgs = serializeCall.mock.calls[0][0];
      const toolInvocation = serializedArgs.toolInvocations[0];

      expect(toolInvocation.input.newFiles).toMatchObject([
        {
          fileName: 'note1.md',
          content: 'translated_create.contentOmitted',
        },
      ]);
    });

    it('should keep content as undefined for files without content', async () => {
      const toolCall = createToolCall({
        folder: 'notes',
        newFiles: [{ fileName: 'empty.md' }],
      });

      await vaultCreate.executeCreatePlan({
        title: 'test-conversation',
        plan: { folder: 'notes', newFiles: [{ fileName: 'empty.md' }] },
        lang: 'en',
        handlerId: 'handler-1',
        toolCall,
      });

      const serializeCall = mockAgent.renderer.serializeToolInvocation as jest.Mock;
      const serializedArgs = serializeCall.mock.calls[0][0];
      const toolInvocation = serializedArgs.toolInvocations[0];

      expect(toolInvocation.input.newFiles).toMatchObject([
        {
          fileName: 'empty.md',
          content: undefined,
        },
      ]);
    });

    it('should handle mixed files with and without content', async () => {
      const toolCall = createToolCall({
        folder: 'project',
        newFiles: [
          { fileName: 'readme.md', content: '# Project\nLong description here...' },
          { fileName: 'empty.md' },
          { fileName: 'config.base', content: 'key: value' },
        ],
      });

      await vaultCreate.executeCreatePlan({
        title: 'test-conversation',
        plan: {
          folder: 'project',
          newFiles: [
            { fileName: 'readme.md', content: '# Project\nLong description here...' },
            { fileName: 'empty.md' },
            { fileName: 'config.base', content: 'key: value' },
          ],
        },
        lang: 'en',
        handlerId: 'handler-1',
        toolCall,
      });

      const serializeCall = mockAgent.renderer.serializeToolInvocation as jest.Mock;
      const serializedArgs = serializeCall.mock.calls[0][0];
      const toolInvocation = serializedArgs.toolInvocations[0];
      const serializedFiles = toolInvocation.input.newFiles;

      expect(serializedFiles).toMatchObject([
        { fileName: 'readme.md', content: 'translated_create.contentOmitted' },
        { fileName: 'empty.md', content: undefined },
        { fileName: 'config.base', content: 'translated_create.contentOmitted' },
      ]);
    });

    it('should preserve the original toolCall input without mutating it', async () => {
      const originalContent = 'This content should remain unchanged on the original object';
      const toolCall = createToolCall({
        folder: 'notes',
        newFiles: [{ fileName: 'note.md', content: originalContent }],
      });

      await vaultCreate.executeCreatePlan({
        title: 'test-conversation',
        plan: { folder: 'notes', newFiles: [{ fileName: 'note.md', content: originalContent }] },
        lang: 'en',
        handlerId: 'handler-1',
        toolCall,
      });

      // Original toolCall should not be mutated
      expect(toolCall.input.newFiles[0].content).toBe(originalContent);
    });

    it('should include createdFiles and errors in the serialized output', async () => {
      const toolCall = createToolCall({
        folder: 'notes',
        newFiles: [{ fileName: 'note.md', content: 'content' }],
      });

      await vaultCreate.executeCreatePlan({
        title: 'test-conversation',
        plan: { folder: 'notes', newFiles: [{ fileName: 'note.md', content: 'content' }] },
        lang: 'en',
        handlerId: 'handler-1',
        toolCall,
      });

      const serializeCall = mockAgent.renderer.serializeToolInvocation as jest.Mock;
      const serializedArgs = serializeCall.mock.calls[0][0];
      const toolInvocation = serializedArgs.toolInvocations[0];

      expect(toolInvocation.output).toEqual({
        type: 'json',
        value: {
          createdFiles: ['notes/note.md'],
          errors: [],
        },
      });
    });
  });
});
