import { CommandIntent } from 'src/types/types';
import { languageEnforcementFragment } from 'src/lib/modelfusion/prompts/fragments';

export function searchPromptV2(command: CommandIntent) {
  // Check if command exists and if the query includes a tag pattern
  const hasTag = command.query && /#[^\s#]+/.test(command.query);

  return `You are a helpful assistant that extracts parameters from user queries for an Obsidian note search system.

Your job is to analyze the user's natural language request and extract the relevant search parameters.

Let's say the user's query is: <query>
GUIDELINES:
- If the <query> lacks search intention, assume it is the keyword for searching.
- If there are any typos in the <query>, extract both the original and your corrected version
- If the <query> includes or mentions "note", include the property {name: "file_type", value: "md"}
${hasTag ? '- The <query> included one or more tags prefixed with #, extract them as tag properties with value without the # symbol, for example: #project -> {name: "tag", value: "project"}' : ''}
- For folders and filenames, use regex to represent user-specified exact: ^<query>$, start with: ^<query>, or contain: <query>
${languageEnforcementFragment}`;
}
