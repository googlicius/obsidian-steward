import {
  formatQueryTemplatesForPrompt,
  formatCurrentArtifacts,
} from 'src/lib/modelfusion/prompts/commands';
import { joinWithConjunction, removeConsecutiveItems } from 'src/utils/arrayUtils';
import { twoStepExtractionPrompt } from './twoStepExtractionPrompt';

export function getQueryExtractionPrompt(args: {
  commandTypes: string[];
  currentArtifacts?: Array<{ type: string }>;
}) {
  const { currentArtifacts } = args;
  // Remove consecutive commands to avoid duplicate commands descriptions and templates
  const commandTypes = removeConsecutiveItems(args.commandTypes);

  const queryTemplates = formatQueryTemplatesForPrompt(commandTypes);

  return `${twoStepExtractionPrompt(2)}

You are a helpful assistant extracting specific queries for commands in an Obsidian note management system.

Your role is to analyze a user's natural language query and extract specific queries for each command in the sequence.

COMMANDS TO EXTRACT QUERIES FOR:
${joinWithConjunction(
  commandTypes.map(cmd => `"${cmd}"`),
  'and'
)}

CURRENT ARTIFACTS:
${formatCurrentArtifacts(currentArtifacts)}

QUERY TEMPLATES:
${queryTemplates}

GUIDELINES:
- If any command does not have a query template, extract its query based on your understanding.
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
