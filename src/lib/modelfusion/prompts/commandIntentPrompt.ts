import {
  formatCommandsForPrompt,
  getAllQueryTemplatesAsString,
  getArtifactInstructions,
  formatCurrentArtifacts,
} from './commands';

export function getCommandIntentPrompt(args: {
  commandNames: string[] | null;
  currentArtifacts?: Array<{ type: string }>;
}) {
  return `You are a helpful assistant analyzing user queries to determine their intent for an Obsidian note management system.

Your role is to analyze a user's natural language query and output a sequence of commands from the available list to fulfill the task efficiently.

AVAILABLE COMMANDS:
${formatCommandsForPrompt(args.commandNames)}

ARTIFACT INSTRUCTIONS:
${getArtifactInstructions(args.commandNames)}

CURRENT ARTIFACTS:
${formatCurrentArtifacts(args.currentArtifacts)}

GUIDELINES:
${retrieveGuidelines(args.commandNames)}

TEMPLATES (Command's query extraction guidelines):
${getAllQueryTemplatesAsString(args.commandNames)}`;
}

function retrieveGuidelines(commandNames?: string[] | null) {
  let result = `- Always reason step-by-step: First, understand the user's query. Then, break it down into subtasks. Finally, map subtasks to the sequence of commands needed.
- Output ONLY a sequence of commands if they can fulfill the query.
- Use "read" or "search", if you need more information (e.g., to check note content before editing).
- IMPORTANT: This is a one-round extraction, so ensure you include all necessary commands to fulfill the query.
- For editing tasks (move, copy, update, delete), ensure there is a relevant artifact; infer it from context, or use "search", "read" to find it.
  - Type 1: Editing from content that is already given in the user's query. For this, including the "generate" command is enough (use it to produce the edited content directly).
  - Type 2: Editing from content that is the result of the "read" or "search" commands (these results are stored as artifacts). For this, first use "read" or "search" to obtain the artifacts, second include "generate" if needed, then include "move_from_artifact", "copy_from_artifact", "update_from_artifact", or "delete_from_artifact" to perform the actual update to the note(s)
    Example: "Update the list above to the numbered list" -> ["read", "generate", "update_from_artifact"]. Explain: "First, read the content above and store it as read_artifact, then generate the edited content from the read_artifact and store another artifact is update_artifact, then update the note(s) from the update_artifact"`;

  if (commandNames && commandNames.length > 0) {
    result += `\n- This query is a previous extraction, please include the commands in this order: [${commandNames.map(cmd => `"${cmd}"`).join(', ')}]`;
  }

  return result;
}
