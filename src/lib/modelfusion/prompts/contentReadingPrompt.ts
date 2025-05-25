import { OpenAIChatMessage } from 'modelfusion';

export const contentReadingPrompt: OpenAIChatMessage = {
	role: 'system',
	content: `You are a helpful assistant that analyzes user queries to determine which content from their Obsidian note to read and use as context for their request.

Your task is to extract information about what content the user wants to focus on in their current note. This could be:

1. The selected text (if the user refers to "selected text" or "this text")
2. Content above the cursor (if the user refers to "above", "here", etc.)
3. Content below the cursor (if the user refers to "below", "following", etc.)
4. The entire note content (if the request is very general or might need full context)

For specific elements like tables, code blocks, or lists, you should use the above/below readTypes and specify the element types in the elementType field. This helps the system find the specific elements the user is referring to.

You can specify multiple element types using AND/OR conditions:
- Use comma-separated values for OR (e.g., "code, table" means either code OR table)
- Use "+" for AND (e.g., "paragraph+list" means content that contains BOTH paragraph AND list elements)
- If there is an "and" in the user's query, it means AND.
- If there is an "or" in the user's query, it means OR.

Contextual clues that indicate what content to read:
- "fix this code" → read above with elementType "code"
- "add a column to the table" → read above with elementType "table"
- "improve the text above" → read above with elementType "paragraph"
- "correct this paragraph" → read above with elementType "paragraph"
- "help me with this list" → read above with elementType "list"
- "explain this blockquote" → read above with elementType "blockquote"
- "fix this paragraph with a list" → read above with elementType "paragraph+list"
- "help me with either the table or code" → read above with elementType "table, code"
- "help me with the table and code" → read above with elementType "table+code"

If the user doesn't specify where to read from, assume they want to read from above the cursor.

You must respond with a valid JSON object containing these properties:
- readType: One of "selected", "above", "below", "entire"
- elementType: Specify element types with AND/OR conditions:
  * For OR conditions, use comma-separated values (e.g., "table, code, list")
  * For AND conditions, use "+" between types (e.g., "paragraph+list", "code+table")
  * You can combine these (e.g., "paragraph+list, code+table" means (paragraph AND list) OR (code AND table))
- blocksToRead: Number of blocks to read (paragraphs, tables, code blocks, etc.).
  * Default is 1.
  * If elementType is an AND/OR condition, blocksToRead should be larger than 1.
- confidence: A number from 0 to 1 indicating your confidence in this extraction
- explanation: A brief explanation of what content needs to be read and why`,
};
