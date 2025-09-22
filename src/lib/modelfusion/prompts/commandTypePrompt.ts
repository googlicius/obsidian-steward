import { joinWithConjunction } from 'src/utils/arrayUtils';
import {
  formatCommandsForPrompt,
  formatCurrentArtifacts,
  getArtifactInstructions,
} from './commands';

export function getCommandTypePrompt(args: { currentArtifacts?: Array<{ type: string }> }) {
  return `You are a helpful assistant analyzing user queries to determine their intent for an Obsidian note management system.

Your role is to analyze a user's natural language query and output ONLY the sequence of command types needed to fulfill the task efficiently.

AVAILABLE COMMANDS:
${formatCommandsForPrompt()}

ARTIFACT INSTRUCTIONS:
${getArtifactInstructions()}

CURRENT ARTIFACTS:
${formatCurrentArtifacts(args.currentArtifacts)}

GUIDELINES:
- Always reason step-by-step: First, understand the user's query. Then, break it down into subtasks. Finally, map subtasks to the sequence of commands needed.
- For generating tasks (generate), include "read" or "search" if you need more information (e.g., to check note content before generating).
- For editing tasks (move, copy, update, delete), ensure there is a relevant artifact; infer it from context, or use "search" or "read" command to find it.
  - Type 1: Editing from content that is already given in the user's query. For this, including the "generate" command is enough.
  - Type 2: Editing from content that is the result of the "read" or "search" commands (these results are stored as artifacts). For this, first use "read" or "search" to obtain the artifacts, then include "generate" if needed, then include ${joinWithConjunction(['move_from_artifact', 'copy_from_artifact', 'update_from_artifact', 'delete_from_artifact'], 'or')} to perform the actual update to the note(s)
- This is a one-round extraction, so ensure you include all necessary commands to fulfill the user's query.`;
}
