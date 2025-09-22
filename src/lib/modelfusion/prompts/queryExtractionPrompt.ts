import { getCommandDefinition, getCommandQueryTemplate, formatCurrentArtifacts } from './commands';
import { joinWithConjunction } from 'src/utils/arrayUtils';

export function getQueryExtractionPrompt(args: {
  commandTypes: string[];
  currentArtifacts?: Array<{ type: string }>;
}) {
  const { commandTypes, currentArtifacts } = args;

  // Get command descriptions for the specified command types
  const commandDescriptions = commandTypes
    .map(cmdType => {
      const cmd = getCommandDefinition(cmdType);
      if (!cmd) return `- "${cmdType}": Unknown command`;

      const aliases = cmd.aliases ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
      return `- "${cmd.commandType}"${aliases}: ${cmd.description}`;
    })
    .join('\n');

  // Get query templates for the specified command types
  const queryTemplates = commandTypes
    .map(cmdType => {
      const template = getCommandQueryTemplate(cmdType);
      if (!template) return '';
      return `## ${cmdType} command template:\n${template}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return `You are a helpful assistant extracting specific queries for commands in an Obsidian note management system.

Your role is to analyze a user's natural language query and extract specific queries for each command in the sequence.

COMMANDS TO EXTRACT QUERIES FOR:
${commandDescriptions}

CURRENT ARTIFACTS:
${formatCurrentArtifacts(currentArtifacts)}

QUERY TEMPLATES:
${queryTemplates}

GUIDELINES:
- If any command does not have a QUERY TEMPLATE instruction, extract its query based on your understanding.
- For each command in the sequence, extract a specific query that will be processed by specialized handlers.
- Keep queries concise and focused on the specific command's requirements.
- DO NOT provide your answers or opinions directly in command's queries.
- Queries must be in the user's perspective.
- This is a one-round extraction, so ensure you include all necessary information in each query.
- You MUST include all of the given commands: ${joinWithConjunction(
    commandTypes.map(cmd => `"${cmd}"`),
    'and'
  )}.`;
}
