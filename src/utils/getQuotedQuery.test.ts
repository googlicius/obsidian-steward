// getQuotedQuery.test.ts
import { getQuotedQuery } from './getQuotedQuery';

describe('getQuotedQuery', () => {
  it('returns inner content for string wrapped in matching double quotes', () => {
    expect(getQuotedQuery(' "hello" ')).toBe('hello'); // Trims outer spaces
  });

  it('returns inner content for string wrapped in matching single quotes', () => {
    expect(getQuotedQuery(" 'hello' ")).toBe('hello');
  });

  it('returns inner content with spaces inside quotes', () => {
    expect(getQuotedQuery('"hello world"')).toBe('hello world');
  });

  it('returns inner content with inner escaped quotes', () => {
    expect(getQuotedQuery('"hello \\"world\\""')).toBe('hello \\"world\\"');
  });

  it('returns inner content with inner unmatched quotes (treated as content)', () => {
    expect(getQuotedQuery('"hello \'world\'"')).toBe("hello 'world'");
  });

  it('returns null for mismatched quotes', () => {
    expect(getQuotedQuery('"hello\'')).toBeNull();
    expect(getQuotedQuery('\'hello"')).toBeNull();
  });

  it('returns null for unquoted strings', () => {
    expect(getQuotedQuery('hello')).toBeNull();
    expect(getQuotedQuery(' hello world ')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(getQuotedQuery('')).toBeNull();
    expect(getQuotedQuery('   ')).toBeNull();
  });

  it('returns null for empty quotes (requires non-empty inner content)', () => {
    expect(getQuotedQuery('""')).toBeNull();
    expect(getQuotedQuery("''")).toBeNull();
  });

  it('returns null if there are multiple quotes', () => {
    expect(getQuotedQuery('"cat" and "dog"')).toBeNull();
  });

  it('returns inner space for quotes with only space inside', () => {
    expect(getQuotedQuery('" "')).toBe(' ');
    expect(getQuotedQuery("' '")).toBe(' ');
  });

  it('returns null if quotes are not at the very start and end', () => {
    expect(getQuotedQuery('a"hello"b')).toBeNull();
  });
});
