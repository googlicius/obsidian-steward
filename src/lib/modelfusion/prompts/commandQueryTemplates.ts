export const commandQueryTemplates: Record<string, string> = {
  read: `Extract a specific query for a read command:
1. Preserve Specific Categories:
   - Positions: Keep positions exactly as written: above, below, entire.
   - Elements: Keep element names exactly as written: paragraphs, tables, images, code blocks, lists, etc.
   - Note names: Keep note names exactly as written

2. Maintain Natural Language:
   - Keep the query in natural language form
   - Don't convert natural language expressions into structured queries
   - Preserve the original wording and context
   
3. Ensure the query is clear and concise`,

  search: `Extract specific details for a search command:
1. Preserve Specific Categories:
   - Keywords: Keep any specific words or phrases the user wants to search for
   - Tags: Keep hashtags (#tag) exactly as written
   - Folders: Keep folder names exactly as written, including quotes if present
   - File names: Keep file names exactly as written

2. Maintain Natural Language:
   - Keep the search query in natural language form
   - Don't convert natural language expressions into structured queries
   - Preserve the original wording and context`,

  move_from_artifact: `Extract specific details for a move_from_artifact command:
- The query MUST include the destination folder where files should be moved`,

  copy_from_artifact: `Extract specific details for a copy_from_artifact command:
- The query MUST include the destination folder where files should be copied`,

  delete_from_artifact: `Extract specific details for a delete_from_artifact command:
- The query always be: "Delete all notes in the search result."`,
};

export function commandQueryTemplatesAsString(commandNames: string[] | null): string {
  return Object.entries(commandQueryTemplates).reduce((result, [key, value]) => {
    if (!commandNames || commandNames.includes(key)) {
      return result.length
        ? `${result}\n\n## ${key} command template:\n${value}`
        : `## ${key} command template:\n${value}`;
    }
    return result;
  }, '');
}
