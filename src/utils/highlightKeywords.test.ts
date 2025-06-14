import { generateNgrams } from './highlightKeywords'; // Adjust import path as needed

describe('generateNgrams', () => {
  it('should handle empty array', () => {
    const keyword = '';
    const result = generateNgrams(keyword);
    expect(result).toEqual([]);
  });

  it('should handle single-word keyword', () => {
    const keyword = 'test';
    const result = generateNgrams(keyword);
    expect(result).toEqual(['test']);
  });

  it('should trim whitespace from the keyword', () => {
    const keyword = '  test  ';
    const result = generateNgrams(keyword);
    expect(result).toEqual(['test']);
  });

  it('should generate all possible n-grams for a multi-word keyword', () => {
    const keyword = 'hello world';
    const result = generateNgrams(keyword);

    expect(result).toEqual(['hello world']);
  });

  it('should generate n-grams that are at least 70% of the keyword length', () => {
    const keyword = 'one two three four five six';
    const result = generateNgrams(keyword);

    expect(result).toEqual([
      'one two three four five six',
      'one two three four five',
      'two three four five six',
      'two three four five',
      'three four five six',
      'one two three four',
    ]);
  });
});
