import { CommandSyntaxParser } from './CommandSyntaxParser';
import { ToolName } from '../toolNames';

describe('CommandSyntaxParser', () => {
  describe('isCommandSyntax', () => {
    it('should return true for queries starting with c:', () => {
      expect(CommandSyntaxParser.isCommandSyntax('c:read --blocks=1')).toBe(true);
    });

    it('should return true with leading whitespace', () => {
      expect(CommandSyntaxParser.isCommandSyntax('  c:read --blocks=1')).toBe(true);
    });

    it('should return false for non-command queries', () => {
      expect(CommandSyntaxParser.isCommandSyntax('search for notes')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(CommandSyntaxParser.isCommandSyntax('')).toBe(false);
    });
  });

  describe('parse', () => {
    it('should parse a single command without args', () => {
      const result = CommandSyntaxParser.parse('c:conclude');
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].toolAlias).toBe('conclude');
      expect(result.commands[0].args).toEqual({});
    });

    it('should parse a single command with args', () => {
      const result = CommandSyntaxParser.parse('c:read --blocks=1 --element=list');
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].toolAlias).toBe('read');
      expect(result.commands[0].args).toEqual({
        blocks: '1',
        element: 'list',
      });
    });

    it('should parse quoted values with spaces', () => {
      const result = CommandSyntaxParser.parse('c:search --keywords="meeting notes"');
      expect(result.errors).toHaveLength(0);
      expect(result.commands[0].args).toEqual({
        keywords: 'meeting notes',
      });
    });

    it('should parse single-quoted values', () => {
      const result = CommandSyntaxParser.parse("c:speech --text='hello world'");
      expect(result.errors).toHaveLength(0);
      expect(result.commands[0].args).toEqual({
        text: 'hello world',
      });
    });

    it('should parse boolean flags without values', () => {
      const result = CommandSyntaxParser.parse('c:read --blocks=1 --verbose');
      expect(result.errors).toHaveLength(0);
      expect(result.commands[0].args.verbose).toBe('true');
    });

    it('should parse chained commands separated by semicolon', () => {
      const result = CommandSyntaxParser.parse(
        'c:read --blocks=1 --element=list; c:edit --mode=replace_by_lines'
      );
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(2);
      expect(result.commands[0].toolAlias).toBe('read');
      expect(result.commands[0].args).toEqual({ blocks: '1', element: 'list' });
      expect(result.commands[1].toolAlias).toBe('edit');
      expect(result.commands[1].args).toEqual({ mode: 'replace_by_lines' });
    });

    it('should not split on semicolons inside quotes', () => {
      const result = CommandSyntaxParser.parse('c:edit --content="hello; world"');
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0].args.content).toBe('hello; world');
    });

    it('should return error for unknown tool alias', () => {
      const result = CommandSyntaxParser.parse('c:unknowntool --arg=1');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Unknown tool alias');
      expect(result.commands).toHaveLength(0);
    });

    it('should return error for empty alias', () => {
      const result = CommandSyntaxParser.parse('c: --arg=1');
      // "c:" followed by space means alias is empty
      const result2 = CommandSyntaxParser.parse('c:');
      expect(result.errors.length + result2.errors.length).toBeGreaterThan(0);
    });

    it('should parse comma-separated values as a single raw string', () => {
      const result = CommandSyntaxParser.parse('c:read --files=Note1.md,Note2.md');
      expect(result.errors).toHaveLength(0);
      expect(result.commands[0].args.files).toBe('Note1.md,Note2.md');
    });

    it('should handle three chained commands', () => {
      const result = CommandSyntaxParser.parse(
        'c:search --keywords=test; c:read --blocks=1; c:edit --mode=insert'
      );
      expect(result.errors).toHaveLength(0);
      expect(result.commands).toHaveLength(3);
      expect(result.commands[0].toolAlias).toBe('search');
      expect(result.commands[1].toolAlias).toBe('read');
      expect(result.commands[2].toolAlias).toBe('edit');
    });
  });

  describe('toToolCalls', () => {
    it('should produce a ToolCallPart for c:read', () => {
      const { commands } = CommandSyntaxParser.parse('c:read --blocks=2 --element=table');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe(ToolName.CONTENT_READING);
      expect(toolCalls[0].type).toBe('tool-call');
      expect(toolCalls[0].input).toMatchObject({
        readType: 'above',
        blocksToRead: 2,
        elementType: 'table',
        fileNames: [],
        confidence: 1,
      });
    });

    it('should coerce number values', () => {
      const { commands } = CommandSyntaxParser.parse('c:read --blocks=-1');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].input.blocksToRead).toBe(-1);
    });

    it('should coerce string[] values from comma-separated', () => {
      const { commands } = CommandSyntaxParser.parse('c:read --files=A.md,B.md,C.md');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].input.fileNames).toEqual(['A.md', 'B.md', 'C.md']);
    });

    it('should produce edit tool call with operations wrapper', () => {
      const { commands } = CommandSyntaxParser.parse(
        'c:edit --mode=replace_by_lines --path=Test.md --from=5 --to=10 --content="new text"'
      );
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe(ToolName.EDIT);

      const input = toolCalls[0].input as Record<string, unknown>;
      expect(input.explanation).toBe('Command syntax edit');
      expect(Array.isArray(input.operations)).toBe(true);

      const ops = input.operations as Array<Record<string, unknown>>;
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        mode: 'replace_by_lines',
        path: 'Test.md',
        fromLine: 5,
        toLine: 10,
        content: 'new text',
      });
    });

    it('should produce search tool call with operations wrapper', () => {
      const { commands } = CommandSyntaxParser.parse(
        'c:search --keywords=meeting,notes --folders=Projects'
      );
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe(ToolName.SEARCH);

      const input = toolCalls[0].input as Record<string, unknown>;
      expect(input.confidence).toBe(1);
      expect(Array.isArray(input.operations)).toBe(true);

      const ops = input.operations as Array<Record<string, unknown>>;
      expect(ops[0]).toMatchObject({
        keywords: ['meeting', 'notes'],
        folders: ['Projects'],
        filenames: [],
      });
    });

    it('should produce delete tool call with artifactId', () => {
      const { commands } = CommandSyntaxParser.parse('c:delete --artifact=abc123');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].toolName).toBe(ToolName.DELETE);
      const input = toolCalls[0].input as Record<string, unknown>;
      const ops = input.operations as Array<Record<string, unknown>>;
      expect(ops[0]).toMatchObject({ mode: 'artifactId', artifactId: 'abc123' });
    });

    it('should produce delete tool call with files', () => {
      const { commands } = CommandSyntaxParser.parse('c:delete --files=a.md,b.md');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      const input = toolCalls[0].input as Record<string, unknown>;
      const ops = input.operations as Array<Record<string, unknown>>;
      expect(ops[0]).toMatchObject({ mode: 'files', files: ['a.md', 'b.md'] });
    });

    it('should produce move tool call', () => {
      const { commands } = CommandSyntaxParser.parse('c:move --artifact=abc --destination=Archive');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].toolName).toBe(ToolName.MOVE);
      expect(toolCalls[0].input).toMatchObject({
        operations: [{ mode: 'artifactId', artifactId: 'abc' }],
        destinationFolder: 'Archive',
      });
    });

    it('should produce list tool call', () => {
      const { commands } = CommandSyntaxParser.parse('c:list --folder=Projects');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].toolName).toBe(ToolName.LIST);
      expect(toolCalls[0].input).toMatchObject({ folderPath: 'Projects' });
    });

    it('should produce grep tool call', () => {
      const { commands } = CommandSyntaxParser.parse('c:grep --pattern=TODO --paths=src');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].toolName).toBe(ToolName.GREP);
      expect(toolCalls[0].input).toMatchObject({
        contentPattern: 'TODO',
        paths: ['src'],
      });
    });

    it('should produce speech tool call with defaults', () => {
      const { commands } = CommandSyntaxParser.parse('c:speech --text="Hello world"');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].toolName).toBe(ToolName.SPEECH);
      expect(toolCalls[0].input).toMatchObject({
        text: 'Hello world',
        explanation: 'Command syntax speech',
        confidence: 1,
      });
    });

    it('should produce conclude tool call with defaults', () => {
      const { commands } = CommandSyntaxParser.parse('c:conclude');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolName).toBe(ToolName.CONCLUDE);
      expect(toolCalls[0].input).toMatchObject({
        parallelToolName: '',
        validation: {},
      });
    });

    it('should produce conclude tool call with custom text', () => {
      const { commands } = CommandSyntaxParser.parse('c:conclude --text="All tasks completed"');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].toolName).toBe(ToolName.CONCLUDE);
      expect(toolCalls[0].input).toMatchObject({
        parallelToolName: '',
        validation: {},
      });
    });

    it('should produce conclude tool call with artifact validation', () => {
      const { commands } = CommandSyntaxParser.parse(
        'c:conclude --parallel=edit --expectedArtifactType=edit_results'
      );
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls[0].input).toMatchObject({
        parallelToolName: 'edit',
        validation: { expectedArtifactType: 'edit_results' },
      });
    });

    it('should handle search with property shorthand', () => {
      const { commands } = CommandSyntaxParser.parse(
        'c:search --properties=tag:todo,status:active'
      );
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      const input = toolCalls[0].input as Record<string, unknown>;
      const ops = input.operations as Array<Record<string, unknown>>;
      expect(ops[0].properties).toEqual([
        { name: 'tag', value: 'todo' },
        { name: 'status', value: 'active' },
      ]);
    });

    it('should skip unknown flags silently', () => {
      const { commands } = CommandSyntaxParser.parse('c:read --blocks=1 --unknownflag=xyz');
      const toolCalls = CommandSyntaxParser.toToolCalls(commands);

      expect(toolCalls).toHaveLength(1);
      // unknownflag should not appear in input
      expect(toolCalls[0].input).not.toHaveProperty('unknownflag');
    });
  });

  describe('parseAndConvert', () => {
    it('should return null for non-command syntax', () => {
      expect(CommandSyntaxParser.parseAndConvert('search for notes')).toBeNull();
    });

    it('should return null for invalid command alias', () => {
      expect(CommandSyntaxParser.parseAndConvert('c:invalid --arg=1')).toBeNull();
    });

    it('should return tool calls for valid command', () => {
      const result = CommandSyntaxParser.parseAndConvert('c:read --blocks=1');
      expect(result).toMatchObject([
        {
          toolName: ToolName.CONTENT_READING,
        },
      ]);
    });

    it('should return chained tool calls', () => {
      const result = CommandSyntaxParser.parseAndConvert(
        'c:read --blocks=1 --element=list; c:edit --mode=replace_by_lines'
      );

      expect(result).toMatchObject([
        {
          type: 'tool-call',
          toolName: ToolName.CONTENT_READING,
          input: {
            readType: 'above',
            blocksToRead: 1,
            fileNames: [],
            elementType: 'list',
            confidence: 1,
          },
        },
        {
          type: 'tool-call',
          toolName: ToolName.EDIT,
          input: {
            operations: [
              {
                mode: 'replace_by_lines',
              },
            ],
            explanation: 'Command syntax edit',
          },
        },
      ]);
    });

    it('should generate unique toolCallIds', () => {
      const result = CommandSyntaxParser.parseAndConvert('c:read --blocks=1; c:read --blocks=2');
      expect(result).not.toBeNull();
      expect(result![0].toolCallId).not.toBe(result![1].toolCallId);
      expect(result![0].toolCallId).toMatch(/^cmd-syntax-/);
    });

    it('should support chain ending with c:conclude to stop the agent loop', () => {
      const result = CommandSyntaxParser.parseAndConvert(
        'c:read --blocks=1 --element=list; c:conclude --text="Read complete"'
      );
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0].toolName).toBe(ToolName.CONTENT_READING);
      expect(result![1].toolName).toBe(ToolName.CONCLUDE);
    });
  });
});
