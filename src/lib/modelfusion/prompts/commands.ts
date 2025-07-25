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
      'Find notes using the search engine to search notes locally and store the result as artifact',
    category: 'built-in',
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
  },
  {
    commandType: 'copy_from_artifact',
    description: 'Copy notes from the artifact to a destination',
    category: 'intent-based',
    aliases: ['copy'],
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
  },
  {
    commandType: 'revert',
    description: 'Undo the last change or revert to a previous state',
    category: 'intent-based',
  },
  {
    commandType: 'generate',
    description:
      'Generate content with the LLM help (either in a new note or in the conversation). You also can "generate" from the provided content in the user\'s query without reading the note. Example: "Help me update this list to the numbered list:\\n- Item 1\\n- Item 2" -> ["generate"]. The list is already in the query.',
    category: 'intent-based',
  },
  {
    commandType: 'read',
    description:
      'Read content from the current note or specific position: "above", "below". Use this when you don\'t know the content and need to retrieve it before proceeding',
    category: 'intent-based',
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
 * Get valid command types for Zod enum validation (only commands available to LLMs)
 */
export function getValidCommandTypes(): string[] {
  const llmCommands = COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false);
  const commandTypes = llmCommands.map(cmd => cmd.commandType);
  const aliases = llmCommands.flatMap(cmd => cmd.aliases || []);
  return [...commandTypes, ...aliases];
}
