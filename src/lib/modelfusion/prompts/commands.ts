/**
 * Centralized command definitions and descriptions
 * This file contains all available commands and their descriptions
 * for reuse in command intent prompts and help systems
 */

export interface CommandDefinition {
  commandType: string;
  description: string;
  category: 'built-in' | 'intent-based';
  aliases?: string[];
  /**
   * Whether this command is available for LLM intent extraction
   * If false, the command is handled locally and not included in LLM prompts
   */
  availableToLLM?: boolean;
  /**
   * Query template for LLM extraction
   * Provides specific instructions for extracting command parameters
   */
  queryTemplate?: string;
}

/**
 * All available command definitions
 * These are organized by category for better maintainability
 */
export const COMMAND_DEFINITIONS: CommandDefinition[] = [
  // Built-in commands (directly accessible via /<command>)
  {
    commandType: 'search',
    description:
      'Find notes using the search engine to search notes locally and store the result as an artifact',
    category: 'built-in',
    queryTemplate: `Extract specific details for a search command:
1. Preserve Specific Categories:
   - Keywords: Keep any specific words or phrases the user wants to search for
   - Tags: Keep hashtags (#tag) exactly as written
   - Folders: Keep folder names exactly as written, including quotes if present
   - File names: Keep file names exactly as written

2. Maintain Natural Language:
   - Keep the search query in natural language form
   - Don't convert natural language expressions into structured queries
   - Preserve the original wording and context`,
  },
  {
    commandType: 'close',
    description: 'Close the conversation or exit',
    category: 'built-in',
  },
  {
    commandType: 'confirm',
    description: 'Confirm or reject operations',
    category: 'built-in',
    aliases: ['yes', 'no'],
    availableToLLM: false,
  },
  {
    commandType: 'image',
    description: 'Generate an image',
    category: 'built-in',
  },
  {
    commandType: 'audio',
    description: 'Generate audio from text',
    category: 'built-in',
    aliases: ['speak'],
  },
  {
    commandType: 'create',
    description: 'Create a new note with their own content',
    category: 'built-in',
  },
  {
    commandType: 'stop',
    description: 'Stop ongoing operations',
    category: 'built-in',
    aliases: ['abort'],
    availableToLLM: false,
  },
  {
    commandType: 'help',
    description: 'Show this help message',
    category: 'built-in',
    availableToLLM: false,
  },

  // Intent-based commands (available through natural language processing)
  {
    commandType: 'move_from_artifact',
    description: 'Move notes from the artifact to a destination',
    category: 'intent-based',
    aliases: ['move'],
    queryTemplate: `Extract specific details for a move_from_artifact command:
- The query MUST include the destination folder where files should be moved`,
  },
  {
    commandType: 'copy_from_artifact',
    description: 'Copy notes from the artifact to a destination',
    category: 'intent-based',
    aliases: ['copy'],
    queryTemplate: `Extract specific details for a copy_from_artifact command:
- The query MUST include the destination folder where files should be copied`,
  },
  {
    commandType: 'update_from_artifact',
    description: 'Update note(s) from the artifact',
    category: 'intent-based',
    aliases: ['update'],
  },
  {
    commandType: 'delete_from_artifact',
    description: 'Delete note(s) from the artifact',
    category: 'intent-based',
    aliases: ['delete'],
    queryTemplate: `Extract specific details for a delete_from_artifact command:
- The query always be: "Delete all notes in the search result."`,
  },
  {
    commandType: 'revert',
    description: 'Undo the last change or revert to a previous state',
    category: 'intent-based',
  },
  {
    commandType: 'build_search_index',
    description: 'Build or rebuild the search index for all markdown files in the vault',
    category: 'intent-based',
    aliases: ['index', 'build-index', 'search-index'],
  },
  {
    commandType: 'generate',
    description:
      'Generate content with the LLM help (either in a new note or in the conversation). You also can "generate" from the provided content in the user\'s query without reading the note. Example: "Help me update this list to the numbered list:\\n- Item 1\\n- Item 2" -> ["generate"]. The list is already in the query.',
    category: 'intent-based',
    queryTemplate: `Extract the query for generate command follow this format: <query_in_natural_language>; [note name: <noteName>]
- <query_in_natural_language>: Tailored query for generate command.
- <noteName>: Include if mentioned.`,
  },
  {
    commandType: 'read',
    description:
      'Read content from the current note or specific position: "above", "below". Use this when you don\'t know the content and need to retrieve it before proceeding',
    category: 'intent-based',
    queryTemplate: `Extract a specific query for a read command:
1. Extract the query for read command follow this format: <query_in_natural_language>; read type: <readType>[; note name: <noteName>]
  - <query_in_natural_language>: Tailored query for read command.
  - <readType>: abort, below, or entire.
  - <noteName>: The note name to read. Include if the <readType> is "entire".

2. Maintain Natural Language:
   - Keep the query in natural language form
   - Don't convert natural language expressions into structured queries
   - Preserve the original wording and context`,
  },
  {
    commandType: 'thank_you',
    description: 'Express gratitude',
    category: 'intent-based',
    aliases: ['thanks'],
    availableToLLM: false,
  },
  {
    commandType: 'more',
    description: 'Show more results from previous search operations',
    category: 'intent-based',
    availableToLLM: false,
  },
];

/**
 * Get commands by category
 */
export function getCommandsByCategory(category: 'built-in' | 'intent-based'): CommandDefinition[] {
  return COMMAND_DEFINITIONS.filter(cmd => cmd.category === category);
}

/**
 * Get commands that are available to LLMs
 */
export function getLLMAvailableCommands(): CommandDefinition[] {
  return COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false);
}

/**
 * Get a command definition by command type
 */
export function getCommandDefinition(commandType: string): CommandDefinition | undefined {
  return COMMAND_DEFINITIONS.find(
    cmd => cmd.commandType === commandType || (cmd.aliases && cmd.aliases.includes(commandType))
  );
}

/**
 * Get query template for a specific command
 */
export function getCommandQueryTemplate(commandType: string): string | undefined {
  const command = getCommandDefinition(commandType);
  return command?.queryTemplate;
}

/**
 * Get all query templates as a formatted string
 */
export function getAllQueryTemplatesAsString(commandNames?: string[] | null): string {
  const commands = commandNames
    ? COMMAND_DEFINITIONS.filter(cmd => commandNames.includes(cmd.commandType))
    : COMMAND_DEFINITIONS.filter(cmd => cmd.queryTemplate);

  return commands.reduce((result, cmd) => {
    if (cmd.queryTemplate) {
      return result.length
        ? `${result}\n\n## ${cmd.commandType} command template:\n${cmd.queryTemplate}`
        : `## ${cmd.commandType} command template:\n${cmd.queryTemplate}`;
    }
    return result;
  }, '');
}

/**
 * Format commands list for prompt inclusion (only commands available to LLMs)
 */
export function formatCommandsForPrompt(): string {
  return COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false)
    .map(cmd => {
      const aliases = cmd.aliases ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
      return `- "${cmd.commandType}"${aliases}: ${cmd.description}`;
    })
    .join('\n');
}

/**
 * Format commands list for prompt inclusion with query templates (only commands available to LLMs)
 */
export function formatCommandsForPromptWithTemplates(): string {
  return COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false)
    .map(cmd => {
      const aliases = cmd.aliases ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
      let result = `- "${cmd.commandType}"${aliases}: ${cmd.description}`;

      if (cmd.queryTemplate) {
        result += `\n  Template: ${cmd.queryTemplate}`;
      }

      return result;
    })
    .join('\n');
}

/**
 * Get valid command types for Zod enum validation (only commands available to LLMs)
 */
export function getValidCommandTypes(): string[] {
  const llmCommands = COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false);
  const commandTypes = llmCommands.map(cmd => cmd.commandType);
  const aliases = llmCommands.flatMap(cmd => cmd.aliases || []);
  return [...commandTypes, ...aliases];
}
