interface HighlightOptions {
	beforeMark: string;
	afterMark: string;
	contextChars: number;
	minMatchLength: number;
}

export function highlightKeywords(
	keywords: string[],
	content: string,
	options: Partial<HighlightOptions> = {}
): string[] {
	// Default options
	const defaultOptions: HighlightOptions = {
		beforeMark: '==',
		afterMark: '==',
		contextChars: 50,
		minMatchLength: 3,
	};

	const opts = { ...defaultOptions, ...options };

	// Filter out empty keywords
	const filteredKeywords = keywords.filter(keyword => keyword.trim().length > 0);

	if (filteredKeywords.length === 0 || !content) {
		return [];
	}

	// Generate all possible n-grams from the keywords
	const ngrams = generateNgrams(filteredKeywords);

	// Find all matches in the content
	const matches = findMatches(content, ngrams);

	// Sort matches by length (longer matches take precedence)
	matches.sort((a, b) => {
		// Sort by length (descending)
		if (b.text.length !== a.text.length) {
			return b.text.length - a.text.length;
		}
		// If same length, sort by start position
		return a.index - b.index;
	});

	// Remove overlapping matches
	const nonOverlappingMatches = removeOverlappingMatches(matches);

	// Generate highlighted results
	return generateHighlightedResults(content, nonOverlappingMatches, opts);
}

interface Match {
	text: string;
	index: number;
}

// Export for testing purposes
export function generateNgrams(keywords: string[]): string[] {
	const ngrams: Set<string> = new Set();

	for (const keyword of keywords) {
		// Add the full keyword
		ngrams.add(keyword);

		// Generate smaller n-grams for keywords with multiple words
		const words = keyword.split(/\s+/).filter(word => word.length > 0);
		if (words.length > 1) {
			// Add individual words (1-grams)
			for (const word of words) {
				if (word.length > 0) {
					ngrams.add(word);
				}
			}

			// Generate all possible n-grams of lengths 2 to words.length-1
			for (let n = 2; n < words.length; n++) {
				// For each possible starting position
				for (let i = 0; i <= words.length - n; i++) {
					const nGram = words.slice(i, i + n).join(' ');
					ngrams.add(nGram);
				}
			}
		}
	}

	// Sort ngrams by length (descending) to prioritize longer matches
	return Array.from(ngrams).sort((a, b) => b.length - a.length);
}

function findMatches(content: string, terms: string[]): Match[] {
	const matches: Match[] = [];
	const lowerContent = content.toLowerCase();

	for (const term of terms) {
		const lowerTerm = term.toLowerCase();
		let index = 0;

		while ((index = lowerContent.indexOf(lowerTerm, index)) !== -1) {
			matches.push({
				text: content.substring(index, index + term.length),
				index,
			});
			index += 1; // Move forward to find next occurrence
		}
	}

	return matches;
}

function removeOverlappingMatches(matches: Match[]): Match[] {
	if (matches.length <= 1) return matches;

	const result: Match[] = [];
	let lastEnd = -1;

	for (const match of matches) {
		const currentEnd = match.index + match.text.length;

		if (match.index > lastEnd) {
			result.push(match);
			lastEnd = currentEnd;
		}
	}

	return result;
}

function generateHighlightedResults(
	content: string,
	matches: Match[],
	options: HighlightOptions
): string[] {
	if (matches.length === 0) return [];

	const highlights: string[] = [];

	for (const match of matches) {
		const matchText = match.text;
		const matchIndex = match.index;

		// Calculate start and end of context
		const contextStart = Math.max(0, matchIndex - options.contextChars);
		const contextEnd = Math.min(
			content.length,
			matchIndex + matchText.length + options.contextChars
		);

		// Get context with highlight
		const before = content.substring(contextStart, matchIndex);
		const highlighted = options.beforeMark + matchText + options.afterMark;
		const after = content.substring(matchIndex + matchText.length, contextEnd);

		const result = before + highlighted + after;
		highlights.push(result);
	}

	return highlights;
}
