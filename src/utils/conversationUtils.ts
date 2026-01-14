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
  // If no stewardFolder is provided, we can't determine if it's a conversation link
  if (!stewardFolder) {
    return false;
  }

  // Create conversation path pattern with the stewardFolder
  const conversationPathPattern = new RegExp(
    `!\\[\\[${stewardFolder}\\/Conversations\\/.*?\\]\\]`,
    'i'
  );

  // Check if the line matches the conversation path pattern
  return conversationPathPattern.test(line);
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
    const titlePath = linkMatch[1].replace(/\.md$/, '');
    if (titlePath.includes('/')) {
      return titlePath.split('/').pop() || null;
    }
    return titlePath; // Return the full matched content if not a path
  }
  return null;
}
