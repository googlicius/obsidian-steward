import { escapeMarkdown } from './markdownUtils';

describe('escapeMarkdown', () => {
  it('should escape markdown special characters', () => {
    const text = 'This is a test *with* **markdown**';
    const expected = 'This is a test \\*with\\* \\*\\*markdown\\*\\*';
    expect(escapeMarkdown(text)).toBe(expected);
  });

  it('should escape a table', () => {
    const text = [
      '| Column 1 | Column 2 |',
      '|----------|----------|',
      '| Row 1    | Row 2    |',
    ].join('\n');

    expect(escapeMarkdown(text)).toBe(
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
    expect(escapeMarkdown(text, true)).toBe(expected);
  });
});
