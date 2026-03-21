import { PartialJsonFieldExtractor } from './partialJsonFieldExtractor';

describe('PartialJsonFieldExtractor', () => {
  describe('basic extraction (no requiredMode)', () => {
    it('should extract content field from a simple object in one chunk', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":"hello world"}');
      expect(result).toBe('hello world');
    });

    it('should extract content field when fed character by character', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"content":"hello"}';
      let result = '';
      for (const ch of json) {
        result += extractor.feed(ch);
      }
      expect(result).toBe('hello');
    });

    it('should extract content field across multiple chunks', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      let result = '';
      result += extractor.feed('{"con');
      result += extractor.feed('tent":"hel');
      result += extractor.feed('lo wor');
      result += extractor.feed('ld"}');
      expect(result).toBe('hello world');
    });

    it('should ignore non-target fields', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed(
        '{"path":"notes/foo.md","content":"the value","other":"ignored"}'
      );
      expect(result).toBe('the value');
    });

    it('should return empty string when target field is not present', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"path":"notes/foo.md","other":"value"}');
      expect(result).toBe('');
    });

    it('should handle empty content value', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":""}');
      expect(result).toBe('');
    });
  });

  describe('JSON escape handling', () => {
    it('should decode escaped newlines', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":"line1\\nline2"}');
      expect(result).toBe('line1\nline2');
    });

    it('should decode escaped tabs', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":"col1\\tcol2"}');
      expect(result).toBe('col1\tcol2');
    });

    it('should decode escaped quotes', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":"say \\"hello\\""}');
      expect(result).toBe('say "hello"');
    });

    it('should decode escaped backslashes', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":"path\\\\to\\\\file"}');
      expect(result).toBe('path\\to\\file');
    });

    it('should decode unicode escapes', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"content":"\\u0048\\u0065\\u006C\\u006C\\u006F"}');
      expect(result).toBe('Hello');
    });

    it('should handle escape at chunk boundary', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      let result = '';
      result += extractor.feed('{"content":"line1\\');
      result += extractor.feed('nline2"}');
      expect(result).toBe('line1\nline2');
    });
  });

  describe('nested objects and arrays', () => {
    it('should extract content from nested object', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"outer":{"content":"nested value"}}');
      expect(result).toBe('nested value');
    });

    it('should extract content from object inside array', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"items":[{"content":"first"},{"content":"second"}]}');
      expect(result).toBe('firstsecond');
    });

    it('should handle objects with numeric values before content', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"fromLine":5,"toLine":10,"content":"the text"}');
      expect(result).toBe('the text');
    });

    it('should handle boolean and null values before content', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const result = extractor.feed('{"active":true,"deleted":false,"ref":null,"content":"value"}');
      expect(result).toBe('value');
    });
  });

  describe('edit tool structure - operations array', () => {
    it('should extract content from operations array', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json =
        '{"operations":[{"mode":"replace_by_lines","path":"note.md","content":"new text","fromLine":0,"toLine":5}],"explanation":"updating"}';
      const result = extractor.feed(json);
      expect(result).toBe('new text');
    });

    it('should extract content from multiple operations', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json =
        '{"operations":[{"mode":"replace_by_lines","path":"a.md","content":"first"},{"mode":"replace_by_lines","path":"b.md","content":"second"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('firstsecond');
    });

    it('should extract content streamed in small chunks (simulating real deltas)', () => {
      const extractor = new PartialJsonFieldExtractor('content');

      // Simulate streaming with variable chunk sizes
      const chunks = [
        '{"opera',
        'tions":[{"m',
        'ode":"repla',
        'ce_by_lines',
        '","path":"no',
        'tes/foo.md"',
        ',"content":',
        '"Line 1\\nL',
        'ine 2\\nLine',
        ' 3","fromLi',
        'ne":0,"toLi',
        'ne":2}],"ex',
        'planation":"edit"}',
      ];

      let result = '';
      for (const chunk of chunks) {
        result += extractor.feed(chunk);
      }
      expect(result).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('requiredMode filtering', () => {
    it('should extract content when mode matches requiredMode', () => {
      const extractor = new PartialJsonFieldExtractor('content', {
        requiredMode: 'replace_by_lines',
      });
      const json =
        '{"operations":[{"mode":"replace_by_lines","path":"note.md","content":"extracted"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('extracted');
    });

    it('should NOT extract content when mode does not match requiredMode', () => {
      const extractor = new PartialJsonFieldExtractor('content', {
        requiredMode: 'replace_by_lines',
      });
      const json =
        '{"operations":[{"mode":"insert","path":"note.md","content":"should be ignored","line":5}]}';
      const result = extractor.feed(json);
      expect(result).toBe('');
    });

    it('should extract only from matching mode in mixed operations', () => {
      const extractor = new PartialJsonFieldExtractor('content', {
        requiredMode: 'replace_by_lines',
      });
      const json =
        '{"operations":[{"mode":"insert","path":"a.md","content":"ignored","line":0},{"mode":"replace_by_lines","path":"b.md","content":"extracted"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('extracted');
    });

    it('should handle mode appearing after content in the same object', () => {
      const extractor = new PartialJsonFieldExtractor('content', {
        requiredMode: 'replace_by_lines',
      });
      // When mode comes after content, content should not be extracted because mode is unknown at that point
      const json =
        '{"operations":[{"content":"too early","mode":"replace_by_lines","path":"a.md"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('');
    });

    it('should reset mode between objects in the array', () => {
      const extractor = new PartialJsonFieldExtractor('content', {
        requiredMode: 'replace_by_lines',
      });
      const json =
        '{"operations":[{"mode":"replace_by_lines","content":"first"},{"mode":"insert","content":"skipped","line":0},{"mode":"replace_by_lines","content":"third"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('firstthird');
    });

    it('should extract content when streamed across chunks with mode first', () => {
      const extractor = new PartialJsonFieldExtractor('content', {
        requiredMode: 'replace_by_lines',
      });
      const chunks = [
        '{"operations":[{"mode":"replace_by_li',
        'nes","path":"note.md","content":"hel',
        'lo world"}]}',
      ];

      let result = '';
      for (const chunk of chunks) {
        result += extractor.feed(chunk);
      }
      expect(result).toBe('hello world');
    });
  });

  describe('create tool structure - newFiles array', () => {
    it('should extract content from newFiles entry', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json =
        '{"newFolders":["notes"],"newFiles":[{"filePath":"notes/test.md","content":"# Title\\n\\nBody text"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('# Title\n\nBody text');
    });

    it('should extract content from multiple files', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json =
        '{"newFiles":[{"filePath":"notes/a.md","content":"File A"},{"filePath":"notes/b.md","content":"File B"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('File AFile B');
    });

    it('should handle file without content', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json =
        '{"newFiles":[{"filePath":"notes/empty.md"},{"filePath":"notes/full.md","content":"has content"}]}';
      const result = extractor.feed(json);
      expect(result).toBe('has content');
    });
  });

  describe('edge cases', () => {
    it('should handle content field name as substring of another key', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"contentType":"text","content":"actual value"}';
      const result = extractor.feed(json);
      expect(result).toBe('actual value');
    });

    it('should handle very large content across many small chunks', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const largeContent = 'x'.repeat(5000);
      const json = `{"content":"${largeContent}"}`;

      let result = '';
      // Feed 3 chars at a time
      for (let i = 0; i < json.length; i += 3) {
        result += extractor.feed(json.slice(i, i + 3));
      }
      expect(result).toBe(largeContent);
    });

    it('should handle content with markdown formatting', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"content":"# Heading\\n\\n- item 1\\n- item 2\\n\\n**bold** and *italic*"}';
      const result = extractor.feed(json);
      expect(result).toBe('# Heading\n\n- item 1\n- item 2\n\n**bold** and *italic*');
    });

    it('should handle content with wikilinks', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"content":"See [[Other Note]] and [[Folder/Note|Alias]]"}';
      const result = extractor.feed(json);
      expect(result).toBe('See [[Other Note]] and [[Folder/Note|Alias]]');
    });

    it('should handle content with table markdown', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"content":"| Col A | Col B |\\n|-------|-------|\\n| val1  | val2  |"}';
      const result = extractor.feed(json);
      expect(result).toBe('| Col A | Col B |\n|-------|-------|\n| val1  | val2  |');
    });

    it('should handle curly braces inside content string', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"content":"template: {{name}} and {single}"}';
      const result = extractor.feed(json);
      expect(result).toBe('template: {{name}} and {single}');
    });

    it('should handle single character chunks', () => {
      const extractor = new PartialJsonFieldExtractor('content');
      const json = '{"content":"ab"}';
      let result = '';
      for (const ch of json) {
        result += extractor.feed(ch);
      }
      expect(result).toBe('ab');
    });
  });
});
