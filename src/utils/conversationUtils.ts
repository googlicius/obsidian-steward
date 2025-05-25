/**
 * Utility functions for conversation-related operations
 */

/**
 * Check if a line contains a conversation link
 * @param line The line text to check
 * @param stewardFolder Optional steward folder name (e.g., "steward")
 * @returns True if the line appears to be a conversation link
 */
export function isConversationLink(line: string, stewardFolder?: string): boolean {
	// Create conversation path pattern if stewardFolder is provided
	const conversationPathPattern = stewardFolder
		? new RegExp(`!\\[\\[${stewardFolder}\\/Conversations\\/.*?\\]\\]`, 'i')
		: null;

	// Standard patterns for embedded links
	const conversationPatterns = [
		// Embedded link format (any content)
		/!\[\[.*?\]\]/i,
	];

	// Check for stewardFolder/Conversations pattern first if available
	if (conversationPathPattern && conversationPathPattern.test(line)) {
		return true;
	}

	// Fall back to standard patterns
	return conversationPatterns.some(pattern => pattern.test(line));
}

/**
 * Extract the conversation title from a link
 * @param line The line containing a conversation link
 * @returns The conversation title, or null if no link is found
 */
export function extractConversationTitle(line: string): string | null {
	// Look for inline link format: ![[conversation title]] or ![[steward/Conversations/title]]
	const linkMatch = line.match(/!\[\[(.*?)\]\]/);
	if (linkMatch && linkMatch[1]) {
		// Extract just the title part if it's a path
		const titlePath = linkMatch[1];
		if (titlePath.includes('/')) {
			return titlePath.split('/').pop() || null;
		}
		return titlePath; // Return the full matched content if not a path
	}
	return null;
}
