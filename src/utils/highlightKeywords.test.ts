import { highlightKeywords, generateNgrams } from './highlightKeywords'; // Adjust import path as needed

describe('highlightKeywords', () => {
	test('should highlight single keywords', () => {
		const content = 'This is a test content with some keywords in it.';
		const keywords = ['test'];
		const result = highlightKeywords(keywords, content);

		expect(result.length).toBe(1);
		expect(result[0].text).toContain('==test==');
	});

	test('should highlight multi-word keywords', () => {
		const content = 'This is a test content with some keywords in it.';
		const keywords = ['test content'];
		const result = highlightKeywords(keywords, content);

		expect(result.length).toBe(1);
		expect(result[0].text).toContain('==test content==');
	});

	test('should highlight keywords in multi-line content', () => {
		const content = 'This is a test content.\n\nWith multiple lines.\n\nAnd test content repeated.';
		const keywords = ['test content'];
		const result = highlightKeywords(keywords, content);

		expect(result.map(r => r.text)).toMatchSnapshot();
	});

	test('my test 123', () => {
		const content = 'They are my dogs';
		const keywords = ['They are my cat'];
		const result = highlightKeywords(keywords, content);

		expect(result[0].text).toContain('==They are my== dogs');
	});

	test('should highlight keywords in multi-line content 2', () => {
		const content = `I'm planning to refactor the confirmation command. Currently, when users want to move files to non-existing folders, it asks users for confirmation. That part works now.

Another part checks the total number of files; if there are no files, it will not ask users for confirmation when the destination does not exist. However, there is a redundant query for the files occurring twice: once for checking file existence and once for moving files.`;
		const keywords = ['part checks the total number'];
		const result = highlightKeywords(keywords, content);

		expect(result.map(r => r.text)).toMatchSnapshot();
	});

	test('should prioritize longer matches over shorter ones', () => {
		const content = 'This is a test content with some keywords.';
		const keywords = ['test', 'test content'];
		const result = highlightKeywords(keywords, content);

		// Should highlight 'test content' instead of just 'test'
		expect(result.length).toBe(1);
		expect(result[0].text).toContain('==test content==');
		expect(result[0].text).not.toContain('==test== content');
	});

	test('should handle empty keywords array', () => {
		const content = 'This is a test content.';
		const keywords: string[] = [];
		const result = highlightKeywords(keywords, content);

		expect(result.length).toBe(0);
	});

	test('should handle empty content', () => {
		const content = '';
		const keywords = ['test'];
		const result = highlightKeywords(keywords, content);

		expect(result.length).toBe(0);
	});

	test('should use custom markup tags', () => {
		const content = 'This is a test content.';
		const keywords = ['test'];
		const result = highlightKeywords(keywords, content, {
			beforeMark: '<mark>',
			afterMark: '</mark>',
		});

		expect(result.length).toBe(1);
		expect(result[0].text).toContain('<mark>test</mark>');
	});

	test('should include context around matches', () => {
		const longContent =
			'This is a very long content. '.repeat(10) +
			'Here is the keyword. ' +
			'More text follows. '.repeat(10);
		const keywords = ['keyword'];
		const result = highlightKeywords(keywords, longContent, { contextChars: 10 });

		expect(result.length).toBe(1);
		expect(result[0].text).toContain('==keyword==');
	});

	test('should include position data in the result', () => {
		const content = 'This is a test content with a keyword.';
		const keywords = ['keyword'];
		const result = highlightKeywords(keywords, content);

		expect(result.length).toBe(1);
		expect(result[0].lineNumber).toBe(1);
		expect(result[0].start).toBeDefined();
		expect(result[0].end).toBeDefined();
		expect(result[0].text).toContain('==keyword==');
	});

	test('should find individual words from multi-word keywords', () => {
		const content = 'This content has words that appear separately.';
		const keywords = ['content words'];
		const result = highlightKeywords(keywords, content);

		// Should match both 'content' and 'words' separately
		expect(result.length).toBe(2);
		expect(result[0].text).toContain('==content==');
		expect(result[1].text).toContain('==words==');
	});

	test('should handle case insensitive matching', () => {
		const content = 'This is TEST content with some keywords.';
		const keywords = ['test'];
		const result = highlightKeywords(keywords, content);

		expect(result.length).toBe(1);
		expect(result[0].text).toContain('==TEST==');
	});
});

describe('generateNgrams', () => {
	test('should handle empty array', () => {
		const keywords: string[] = [];
		const result = generateNgrams(keywords);
		expect(result).toEqual([]);
	});

	test('should handle single-word keyword', () => {
		const keywords = ['test'];
		const result = generateNgrams(keywords);
		expect(result).toEqual(['test']);
	});

	test('should generate all possible n-grams for a multi-word keyword', () => {
		const keywords = ['hello world'];
		const result = generateNgrams(keywords);

		// Should contain the full phrase and individual words
		expect(result).toContain('hello world');
		expect(result).toContain('hello');
		expect(result).toContain('world');

		// Should be sorted by length (descending)
		expect(result).toEqual(['hello world', 'hello', 'world']);
	});

	test('should generate n-grams for multiple keywords', () => {
		const keywords = ['hello world', 'test phrase'];
		const result = generateNgrams(keywords);

		const expected = ['hello world', 'test phrase', 'hello', 'world', 'test', 'phrase'].sort(
			(a, b) => b.length - a.length
		);

		expect(result).toEqual(expected);
	});

	test('should handle keywords with more than two words', () => {
		const keywords = ['one two three'];
		const result = generateNgrams(keywords);

		expect(result).toContain('one two three');
		expect(result).toContain('one two');
		expect(result).toContain('two three');
		expect(result).toContain('one');
		expect(result).toContain('two');
		expect(result).toContain('three');

		// Should be sorted by length (descending)
		expect(result[0]).toBe('one two three');
	});

	test('should handle multiple spaces between words', () => {
		const keywords = ['hello  world'];
		const result = generateNgrams(keywords);

		expect(result).toContain('hello  world');
		expect(result).toContain('hello');
		expect(result).toContain('world');
	});

	test('should handle keywords with special characters', () => {
		const keywords = ['hello-world', 'test_phrase'];
		const result = generateNgrams(keywords);

		// Should treat these as single words (no spaces)
		expect(result).toEqual(['hello-world', 'test_phrase']);
	});

	test('should prioritize longer phrases in the result order', () => {
		const keywords = ['very long phrase', 'short'];
		const result = generateNgrams(keywords);

		expect(result[0]).toBe('very long phrase');
		expect(result[result.length - 1].length).toBeLessThan(result[0].length);
	});

	test('should correctly handle five-word keyword', () => {
		const keywords = ['one two three four five'];
		const result = generateNgrams(keywords);

		console.log('result', result);

		expect(result).toMatchSnapshot();
	});
});
