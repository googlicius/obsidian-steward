/**
 * Centralized command definitions and descriptions
 * This file contains all available commands and their descriptions
 * for reuse in command intent prompts and help systems
 */

import { stringifyYaml } from 'obsidian';
import { Artifact, ArtifactType } from 'src/solutions/artifact';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { SysError } from 'src/utils/errors';

export interface CommandDefinition {
  commandType: string;
  description: string;
  category: 'built-in' | 'intent-based' | 'manual';
  aliases?: string[];
  includeWhen?: string;
  dontIncludeWhen?: string;
  artifactDesc?: string;
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

interface CommandData {
  name: string;
  description: string;
  aliases?: string[];
  use_when?: string;
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
      'Find files using the search engine to search files locally and store the result as an artifact',
    category: 'built-in',
    queryTemplate: `Extract a specific query for a search command:
1. Extract the query for the search command follows this format: [file name <file_name>][, tag <tag>][, folder <folder>][, keywords <keywords>]
  - <file_name>: If searching for a specific file name.
  - <tag>: If searching for a specific tag, include it with the # symbol.
  - <folder>: If searching in a specific folder.
  - <keywords>: Words or phrases to search for within note content.
  NOTE: Square brackets [] indicate optional part of the query. At least one part must be present.

2. Search Guidelines:
  - Multiple parameters can be combined when needed.
  - Preserve the original wording and context if provided: start with, contain, or exact, for example: "file name start with...", "keywords contain...", "folder exact..."`,
    includeWhen: `Search for files (and doesn't mention existing search results)`,
    dontIncludeWhen: `- If the user mentions "search results", "notes above", or refers to previously found notes, do NOT include a "search" command`,
    artifactDesc: `The search results: list of file paths is stored as the artifact with name ${ArtifactType.SEARCH_RESULTS}`,
  },
  {
    commandType: 'close',
    description: 'Close the conversation or exit',
    category: 'built-in',
    includeWhen: 'Close the conversation',
  },
  {
    commandType: 'confirm',
    description: 'Confirm or reject the current command to proceed',
    category: 'built-in',
    aliases: ['yes', 'no'],
  },
  {
    commandType: 'image',
    description: 'Generate an image',
    category: 'built-in',
    includeWhen: 'Generate an image',
    dontIncludeWhen: `Even if the user mentions an image, but doesn't explicitly ask for generate an image, do NOT include an "image" command`,
    artifactDesc: `The file path of the created image is stored as the artifact with name ${ArtifactType.MEDIA_RESULTS}`,
  },
  {
    commandType: 'audio',
    description: 'Generate audio from text',
    category: 'built-in',
    aliases: ['speak'],
    includeWhen: 'Generate audio',
    artifactDesc: `The file path of the created audio is stored as the artifact with name ${ArtifactType.MEDIA_RESULTS}`,
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
  {
    commandType: 'vault',
    description: `An agent performs vault-related operations. You MUST add a query to activate one or more tools that needs to perform the operation, e.g. 'vault?tools=list,rename'.
Available tools: ${ToolName.LIST}, ${ToolName.RENAME}, ${ToolName.CREATE}, ${ToolName.DELETE}, ${ToolName.COPY}, ${ToolName.UPDATE_FRONTMATTER}, and ${ToolName.MOVE}.
NOTE:
- Use the list tool (vault?tools=${ToolName.LIST}) to list all files in a specific folder instead of using the search command.`,
    category: 'intent-based',
    includeWhen: 'Vault operations (list files, create notes, etc.)',
    artifactDesc: 'Vault agent outputs',
  },

  // Intent-based commands (available through natural language processing)
  {
    commandType: 'update_from_artifact',
    description:
      'Update note(s) content from the artifact. NOTE: This command is used to update the content of the note only. If you need to update the frontmatter properties, use the vault?tool=update_frontmatter.',
    category: 'intent-based',
    aliases: ['update'],
    queryTemplate: `Extract specific details for what to be updated.`,
    includeWhen: 'Update one or more notes from the artifact',
    artifactDesc: `The updated note paths is stored as the artifact with name ${ArtifactType.CONTENT_UPDATE}`,
  },
  {
    commandType: 'summary',
    description: 'Generate a summary of the conversation to provide context and reduce token usage',
    category: 'manual',
    availableToLLM: false,
    artifactDesc: 'The conversation summary',
  },
  {
    commandType: 'build_search_index',
    description: 'Build or rebuild the search index for all markdown files in the vault',
    category: 'intent-based',
    includeWhen: 'Build or rebuild the search index for all markdown files in the vault',
  },
  {
    commandType: 'read',
    description: `Read text contents, images from the current note in specific position: "above", "below". OR from the other notes. Use this when you don't know the content and need to retrieve it before proceeding
- Can read any content type, including code blocks, tables, lists, paragraphs, and more.
- Can multiple notes at once.
- Can read when the note's name or position (above or below) is provided, no location needed.`,
    category: 'intent-based',
    queryTemplate: `Extract a specific query for a read command:
1. Extract the query for the read command follows this format: <query_in_natural_language>, read type: <read_type>[, note name: <note_name>] [; <other_notes_to_read>]
  - <query_in_natural_language>: Tailored query for each read command.
  - <read_type>: above, below, or entire.
  - <note_name>: The note name to read. 
    - If the <read_type> is "entire", include the note name.
    - If the <read_type> is "above" or "below", it means current note, leave the note name blank.
  - <other_notes_to_read>: The other notes to read if needed. Follow the same structure as the previous.
  NOTE: Square brackets [] indicate optional part of the query.

2. Read multiple notes if needed.
  - If the query require read content in one or more notes, include all of them.
    Example: "Read the context above, read type: above; Read the note named 'Note 2', read type: entire, note name: 'Note 2'"

3. Maintain Natural Language:
  - Keep the query in natural language form.`,
    includeWhen: 'Read or Find content based on a specific pattern in their current note',
    artifactDesc: `The content of the reading result is stored as the artifact with name ${ArtifactType.READ_CONTENT}`,
  },
  {
    commandType: 'generate',
    description: `Generate content with the LLM help.
If you see the source content is already included in the user's query, you can use "generate" without the need of reading additional content. Example: "Help me update this list to the numbered list:\n- Item 1\n- Item 2".
Otherwise, you need to include the "read" command.`,
    category: 'intent-based',
    queryTemplate: `Extract the query for the generate command follows this format: <query_in_natural_language>, [note name: <note_name>]
- <query_in_natural_language>: Tailored query for the generate command.
- <note_name>: The existing note name, include only if mentioned in the context.
NOTE: Square brackets [] indicate optional part of the query.`,
    includeWhen: 'Ask, update, or generate content with your help',
    artifactDesc: `The generated content is stored as the artifact with name ${ArtifactType.CONTENT_UPDATE}`,
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
  {
    commandType: 'revert',
    description: `An agent performs revert operations to undo previous actions like delete, update, move, etc.`,
    category: 'intent-based',
    includeWhen: 'Revert or undo previous operations (delete, update, move, etc.)',
    artifactDesc: 'Revert agent outputs',
  },
];

const COMMAND_DEFINITIONS_MAP = COMMAND_DEFINITIONS.reduce((acc, item) => {
  acc.set(item.commandType, item);
  return acc;
}, new Map<string, CommandDefinition>());

function resolveCommandDefinition(commandName: string): CommandDefinition {
  const [baseName] = commandName.split('?', 1);

  const definition =
    COMMAND_DEFINITIONS_MAP.get(baseName) ??
    COMMAND_DEFINITIONS.find(cmd => cmd.aliases && cmd.aliases.includes(baseName));

  if (!definition) {
    throw new SysError(`Command ${baseName} not found`);
  }

  return definition;
}

type AggregatedCommand = {
  commandName: string;
  definition: CommandDefinition;
};

function aggregateCommandNames(commandNames: string[]): AggregatedCommand[] {
  const aggregated = new Map<
    string,
    {
      params: Map<string, string[]>;
      definition: CommandDefinition;
    }
  >();
  const order: string[] = [];

  for (const rawName of commandNames) {
    if (!rawName) continue;
    const [baseName, queryString] = rawName.split('?', 2);

    const definition = resolveCommandDefinition(baseName);

    let entry = aggregated.get(baseName);
    if (!entry) {
      entry = {
        params: new Map<string, string[]>(),
        definition,
      };
      aggregated.set(baseName, entry);
      order.push(baseName);
    }

    if (!queryString) {
      continue;
    }

    const searchParams = new URLSearchParams(queryString);
    for (const [param, rawValue] of searchParams.entries()) {
      const values = rawValue
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);

      let existingValues = entry.params.get(param);
      if (!existingValues) {
        existingValues = [];
        entry.params.set(param, existingValues);
      }

      for (const value of values) {
        if (!existingValues.includes(value)) {
          existingValues.push(value);
        }
      }
    }
  }

  return order.map(baseName => {
    const entry = aggregated.get(baseName);
    if (!entry) {
      throw new SysError(`Command ${baseName} not found`);
    }

    const queryParts: string[] = [];
    for (const [param, values] of entry.params.entries()) {
      if (values.length === 0) {
        continue;
      }
      queryParts.push(`${param}=${values.join(',')}`);
    }

    const commandName = queryParts.length > 0 ? `${baseName}?${queryParts.join('&')}` : baseName;

    return {
      commandName,
      definition: entry.definition,
    };
  });
}

function getCommandDefinitionsFromNames(commandNames: string[]): CommandDefinition[] {
  return aggregateCommandNames(commandNames).map(item => item.definition);
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
 * Get artifact dependent examples as a formatted string
 * Returns examples for commands that depend on artifacts
 */
export function artifactDependentExamples(commands: CommandDefinition[]): string {
  // Find commands that create artifacts
  const artifactCreatingCommands = commands.filter(cmd => cmd.artifactDesc);

  // Find commands that use artifacts (commands with "_from_artifact" in their name)
  const artifactUsingCommands = commands.filter(
    cmd => cmd.commandType.includes('_from_artifact') && cmd.availableToLLM !== false
  );

  if (artifactCreatingCommands.length === 0 || artifactUsingCommands.length === 0) {
    return '';
  }

  // Common and useful combinations
  const commonPairs = [
    { creator: 'read', user: 'update_from_artifact' },
    { creator: 'generate', user: 'update_from_artifact' },
    { creator: 'read', user: 'generate' },
    { creator: 'search', user: 'update_from_artifact' },
  ];

  // Find available pairs from the common combinations
  const availablePairs = commonPairs.filter(pair => {
    const creatorExists = artifactCreatingCommands.some(cmd => cmd.commandType === pair.creator);
    const userExists = artifactUsingCommands.some(cmd => cmd.commandType === pair.user);
    return creatorExists && userExists;
  });

  if (availablePairs.length === 0) {
    return '';
  }

  // Take up to 2 examples to avoid overwhelming the prompt
  const selectedPairs = availablePairs.slice(0, 2);

  const examplesList = selectedPairs.map(pair => {
    return `"${pair.creator}" and "${pair.user}", the "${pair.user}" command will use the artifact that will be created from the "${pair.creator}" command`;
  });

  if (examplesList.length === 1) {
    return `For example: if you include ${examplesList[0]}.`;
  } else if (examplesList.length === 2) {
    return `For example: if you include ${examplesList[0]} or ${examplesList[1]}.`;
  } else {
    const lastExample = examplesList.pop();
    return `For example: if you include ${examplesList.join(', ')}, or ${lastExample}.`;
  }
}

/**
 * Get artifact instructions as a formatted string
 * Returns instructions for commands that create artifacts
 */
export function getArtifactInstructions(commandNames?: string[] | null): string {
  const commands = commandNames
    ? getCommandDefinitionsFromNames(commandNames)
    : COMMAND_DEFINITIONS;

  const artifactCommands = commands.filter(cmd => cmd.artifactDesc);

  if (artifactCommands.length === 0) {
    return 'No commands create artifacts.';
  }

  const artifactList = artifactCommands
    .map(cmd => `  - "${cmd.commandType}": ${cmd.artifactDesc}`)
    .join('\n');

  const examples = artifactDependentExamples(commands);
  const examplesText = examples ? ` ${examples}` : '';

  return `- Artifact is the result of a specific command that is stored temporarily in the local storage. The below commands have their result stored as artifacts:
${artifactList}
- When you include those commands above, artifacts will be CREATED and AVAILABLE for the next commands.${examplesText}`;
}

/**
 * Format commands list for prompt inclusion (only commands available to LLMs)
 */
export function formatCommandsForPrompt(commandNames?: string[] | null): string {
  const commands = commandNames
    ? aggregateCommandNames(commandNames)
    : COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false).map(definition => ({
        commandName: definition.commandType,
        definition,
      }));

  const commandsData = commands.map(({ commandName, definition }) => {
    const commandData: CommandData = {
      name: commandName,
      description: definition.description,
    };

    if (definition.aliases && definition.aliases.length > 0) {
      commandData.aliases = definition.aliases;
    }

    if (definition.includeWhen) {
      commandData.use_when = definition.includeWhen;
    }

    return commandData;
  });

  return stringifyYaml(commandsData);
}

/**
 * Format query templates for prompt inclusion in YAML format
 */
export function formatQueryTemplatesForPrompt(commandNames?: string[] | null): string {
  const commands = commandNames
    ? aggregateCommandNames(commandNames)
    : COMMAND_DEFINITIONS.filter(cmd => cmd.queryTemplate).map(definition => ({
        commandName: definition.commandType,
        definition,
      }));

  const templatesData = commands
    .filter(({ definition }) => definition.queryTemplate)
    .map(({ commandName, definition }) => ({
      command: commandName,
      template: definition.queryTemplate as string,
    }));

  return stringifyYaml(templatesData);
}

/**
 * Format commands list for prompt inclusion with query templates (only commands available to LLMs)
 */
export function formatCommandsForPromptWithTemplates(): string {
  return COMMAND_DEFINITIONS.filter(cmd => cmd.availableToLLM !== false)
    .map(cmd => {
      const aliases = cmd.aliases ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
      let result = `- "${cmd.commandType}"${aliases}: ${cmd.description}`;

      if (cmd.includeWhen) {
        result += `\n  Use when: ${cmd.includeWhen}`;
      }

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

/**
 * Format current artifacts for prompt inclusion
 * Shows only artifact types to provide context for LLMs
 * @param artifacts - Array of artifacts with type
 * @returns Formatted string showing current artifacts, or empty string if none
 */
export function formatCurrentArtifacts(artifacts?: Pick<Artifact, 'artifactType'>[]): string {
  if (!artifacts || artifacts.length === 0) {
    return 'There is no current artifacts in the conversation.';
  }

  // Get unique artifact types
  const uniqueTypes = [...new Set(artifacts.map(artifact => artifact.artifactType))];

  const artifactList = uniqueTypes.map(type => `- ${type}`).join('\n');

  return `Current artifacts in the conversation can be used by artifact-dependent commands:
${artifactList}`;
}
