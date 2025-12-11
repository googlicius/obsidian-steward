import {
  formatCommandsForPrompt,
  formatCurrentArtifacts,
  getArtifactInstructions,
} from 'src/lib/modelfusion/prompts/commands';
import { twoStepExtractionPrompt } from './twoStepExtractionPrompt';
import { Artifact } from 'src/solutions/artifact';

export function getCommandTypePrompt(args: {
  currentArtifacts?: Artifact[];
  isReasoning?: boolean;
}) {
  const prompt = `${twoStepExtractionPrompt(1)}

You are a helpful assistant analyzing user queries to determine their intent for an Obsidian note management system.

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
- For editing tasks (update), ensure there is a relevant artifact; infer it from context, or use "read" command to find it.
  - Type 1: Editing from content that is already given in the user's query. For this, including the "generate" command is enough.
  - Type 2: Editing from content that is the result of the "read" command (The result is stored as artifacts). For this, first use "read" to obtain the artifacts, then include "generate" if needed, then include "update_from_artifact" to perform the actual update to the note(s)
- For vault management tasks (list, create, delete, copy, move, rename, update_frontmatter), include "vault" agent (with appropriate tools) is enough.

NOTE:
- This is a one-round extraction, so ensure you include all necessary commands to fulfill the user's query.`;

  if (args.isReasoning) {
    return `${prompt}

REASONING GUIDELINES:
- Show your complete step-by-step reasoning process before using any tools. 
- Wrap your reasoning in a \`<think>...</think>\` tag.`;
  }

  return prompt;
}
