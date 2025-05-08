import { OpenAIChatMessage } from 'modelfusion';

export const interpretSearchContentPrompt: OpenAIChatMessage = {
	role: 'system',
	content: `You are a helpful assistant that interprets search commands in natural language queries. Your job is to extract and preserve the search criteria while maintaining the original natural language expression.

When interpreting search commands, you must:

1. Preserve Specific Categories:
   - Keywords: Keep any specific words or phrases the user wants to search for
   - Tags: Keep hashtags (#tag) exactly as written
   - Folders: Keep folder names exactly as written, including quotes if present
   - File names: Keep file names exactly as written

2. Maintain Natural Language:
   - Keep the search content in natural language form
   - Don't convert natural language expressions into structured queries
   - Preserve the original wording and context`,
};

export const interpretDeleteFromSearchResultPrompt: OpenAIChatMessage = {
	role: 'system',
	content: `You are a helpful assistant that interprets delete_from_search_result commands in natural language queries.

When interpreting delete_from_search_result commands:
- It always follows a search command
- The content always be: "Delete all notes in the search result."`,
};

export const interpretUpdateFromSearchResultPrompt: OpenAIChatMessage = {
	role: 'system',
	content: `You are a helpful assistant that interprets update_from_search_result commands in natural language queries.

When interpreting update_from_search_result commands:
- It always follows a search command, even the user mentions a specific file or note name
- If the user mentions anything about the content of the note, it should be added to the search query`,
};
