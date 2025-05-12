import { removeStopwords } from '../../stopwords';

export interface Token {
	term: string;
	count: number;
	positions: number[];
}

export interface TokenizerConfig {
	removeStopwords?: boolean;
}

export class Tokenizer {
	private config: TokenizerConfig;

	constructor(config: TokenizerConfig = {}) {
		this.config = config;
	}

	/**
	 * Tokenize content into terms with positions
	 */
	public tokenize(content: string): Token[] {
		// Remove HTML comments
		const withoutHtmlComments = content.replace(/<!--[\s\S]*?-->/g, ' ');

		// Normalize content - lowercase but preserve apostrophes and Unicode characters
		const normalizedContent = withoutHtmlComments.toLowerCase();

		// Use a hardcoded regex pattern similar to the one in searchIndexer
		// This preserves contractions like "I'm" and non-English characters
		const words = normalizedContent
			.replace(/[^\p{L}\p{N}'\u2019\s#_-]/gu, ' ') // Keep letters, numbers, apostrophes, hashtags, underscores, hyphens
			.replace(/[#_-]{2,}/g, ' ') // Filter out 2+ consecutive special characters
			.split(/\s+/)
			.filter(Boolean);

		// Remove stopwords if configured
		const filteredWords = this.config.removeStopwords ? removeStopwords(words) : words;

		// Count term frequencies and positions
		const termMap = new Map<string, { count: number; positions: number[] }>();

		filteredWords.forEach((word: string, position: number) => {
			if (!termMap.has(word)) {
				termMap.set(word, { count: 0, positions: [] });
			}

			const termData = termMap.get(word);
			if (!termData) return;
			termData.count++;
			termData.positions.push(position);
		});

		// Convert map to array
		return Array.from(termMap.entries()).map(([term, data]) => ({
			term,
			count: data.count,
			positions: data.positions,
		}));
	}

	/**
	 * Get unique terms from content
	 */
	public getUniqueTerms(content: string): string[] {
		return this.tokenize(content).map(t => t.term);
	}
}
