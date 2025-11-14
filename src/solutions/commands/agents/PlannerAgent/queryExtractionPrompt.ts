import {
  formatQueryTemplatesForPrompt,
  formatCurrentArtifacts,
} from 'src/lib/modelfusion/prompts/commands';
import { joinWithConjunction, removeConsecutiveItems } from 'src/utils/arrayUtils';
import { twoStepExtractionPrompt } from './twoStepExtractionPrompt';
import { Artifact } from 'src/solutions/artifact';

export function getQueryExtractionPrompt(args: {
  intentTypes: string[];
  currentArtifacts?: Artifact[];
}) {
  const { currentArtifacts } = args;
  // Remove consecutive commands to avoid duplicate commands descriptions and templates
  const intentTypes = removeConsecutiveItems(args.intentTypes);

  const queryTemplates = formatQueryTemplatesForPrompt(intentTypes);

  return `${twoStepExtractionPrompt(2)}

You are a helpful assistant extracting specific queries for intents in an Obsidian note management system.

Your role is to analyze a user's natural language query and extract specific queries for each intent in the sequence.

INTENTS TO EXTRACT QUERIES FOR:
${joinWithConjunction(
  intentTypes.map(cmd => `"${cmd}"`),
  'and'
)}

CURRENT ARTIFACTS:
${formatCurrentArtifacts(currentArtifacts)}

QUERY TEMPLATES:
${queryTemplates}

GUIDELINES:
- If any intent does not have a query template, extract its query based on your understanding.
- For each intent in the sequence, extract a specific query that will be processed by specialized handlers.
- Keep queries concise and focused on the specific command's requirements.
- DO NOT provide your answers or opinions directly in command's queries.
- Queries must be in the user's perspective.
- This is a one-round extraction, so ensure you include all necessary information in each query.
- You MUST include the given intents in the same order: ${joinWithConjunction(
    intentTypes.map(cmd => `"${cmd}"`),
    'and'
  )}.
- Exclude any intent that is unrelated to the user's task.`;
}
