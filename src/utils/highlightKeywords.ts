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
	isInLink?: boolean;
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

	// Regex to find all markdown links in the content
	const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
	const links: { start: number; end: number }[] = [];

	// Find all links in the content
	let linkMatch;
	while ((linkMatch = linkRegex.exec(content)) !== null) {
		links.push({
			start: linkMatch.index,
			end: linkMatch.index + linkMatch[0].length,
		});
	}

	// Also find wiki links [[link]]
	const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
	while ((linkMatch = wikiLinkRegex.exec(content)) !== null) {
		links.push({
			start: linkMatch.index,
			end: linkMatch.index + linkMatch[0].length,
		});
	}

	for (const term of terms) {
		const lowerTerm = term.toLowerCase();
		let index = 0;

		while ((index = lowerContent.indexOf(lowerTerm, index)) !== -1) {
			// Check if this match is inside a link
			const isInLink = links.some(
				link =>
					(index >= link.start && index < link.end) ||
					(index + term.length > link.start && index < link.end)
			);

			matches.push({
				text: content.substring(index, index + term.length),
				index,
				isInLink,
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
	const lines = content.split('\n');

	// Create a map of line numbers to match indices for fast lookup
	const lineMap: { [lineIndex: number]: Match[] } = {};

	// Find which line each match belongs to
	for (const match of matches) {
		let charCount = 0;
		let lineIndex = 0;

		// Find the line number for this match
		while (lineIndex < lines.length) {
			const lineLength = lines[lineIndex].length + 1; // +1 for the newline
			if (charCount <= match.index && match.index < charCount + lineLength) {
				// This match is on this line
				if (!lineMap[lineIndex]) {
					lineMap[lineIndex] = [];
				}
				lineMap[lineIndex].push({
					...match,
					index: match.index - charCount, // adjust index to be relative to line start
				});
				break;
			}
			charCount += lineLength;
			lineIndex++;
		}
	}

	// Process each line that has matches
	for (const lineIndex in lineMap) {
		const lineMatches = lineMap[lineIndex];
		const line = lines[parseInt(lineIndex)];

		// Sort matches by position in the line
		lineMatches.sort((a, b) => a.index - b.index);

		// Build the highlighted line
		let result = '';
		let lastEnd = 0;

		for (const match of lineMatches) {
			// Add text before the match
			result += line.substring(lastEnd, match.index);

			// Add the match, with highlighting if not in a link
			if (match.isInLink) {
				result += match.text; // No highlight if in a link
			} else {
				result += options.beforeMark + match.text + options.afterMark;
			}

			lastEnd = match.index + match.text.length;
		}

		// Add the rest of the line
		result += line.substring(lastEnd);

		highlights.push(result);
	}

	return highlights;
}
