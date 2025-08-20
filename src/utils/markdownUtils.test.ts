import { MarkdownUtil } from './markdownUtils';

describe('MarkdownUtil', () => {
  describe('escape', () => {
    it('should escape markdown special characters', () => {
      const text = 'This is a test *with* **markdown**';
      const expected = 'This is a test \\*with\\* \\*\\*markdown\\*\\*';
      expect(new MarkdownUtil(text).escape().getText()).toBe(expected);
    });

    it('should escape a table', () => {
      const text = [
        '| Column 1 | Column 2 |',
        '|----------|----------|',
        '| Row 1    | Row 2    |',
      ].join('\n');

      expect(new MarkdownUtil(text).escape().getText()).toBe(
        [
          '\\| Column 1 \\| Column 2 \\|',
          '\\|\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\|\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\|',
          '\\| Row 1    \\| Row 2    \\|',
        ].join('\n')
      );
    });

    it('should escape the newlines character', () => {
      const text = 'This is a test\nwith a newline';
      const expected = 'This is a test\\nwith a newline';
      expect(new MarkdownUtil(text).escape(true).getText()).toBe(expected);
    });
  });

  describe('encodeForDataset', () => {
    it('should encode colons and commas for dataset values', () => {
      const text = 'value:with,special:chars';
      const expected = 'value%3Awith%2Cspecial%3Achars';
      expect(new MarkdownUtil(text).encodeForDataset().getText()).toBe(expected);
    });

    it('should not modify other characters', () => {
      const text = 'normal text 123!@#$%^&*()';
      expect(new MarkdownUtil(text).encodeForDataset().getText()).toBe(text);
    });
  });

  describe('decodeFromDataset', () => {
    it('should decode encoded dataset values back to original', () => {
      const encoded = 'value%3Awith%2Cspecial%3Achars';
      const expected = 'value:with,special:chars';
      expect(new MarkdownUtil(encoded).decodeFromDataset().getText()).toBe(expected);
    });

    it('should not modify other characters when decoding', () => {
      const text = 'normal text 123!@#$%^&*()';
      expect(new MarkdownUtil(text).decodeFromDataset().getText()).toBe(text);
    });
  });
});
