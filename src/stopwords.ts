/**
 * List of common English stopwords to filter out from search
 */
const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'but',
	'by',
	'for',
	'if',
	'in',
	'into',
	'is',
	'it',
	'no',
	'not',
	'of',
	'on',
	'or',
	'such',
	'that',
	'the',
	'their',
	'then',
	'there',
	'these',
	'they',
	'this',
	'to',
	'was',
	'will',
	'with',

	// Some specific markdown formatting words
	'*',
	'**',
	'***',
	'---',
	'```',
	'#',
	'##',
	'###',
	'####',
	'#####',
	'######',

	// Some specific characters
	'-',
	'_',
	'`',
	'~',
	'|',
	'{',
	'}',
	'[',
	']',
	'(',
	')',
	'"',
	"'",
	'\\',
	'/',
	'@',
]);

/**
 * Removes stopwords from an array of words
 * @param words Array of words to filter
 * @returns Array with stopwords removed
 */
export function removeStopwords(words: string[]): string[] {
	return words.filter(word => !STOPWORDS.has(word));
}
