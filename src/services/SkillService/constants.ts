export interface BuiltInSkill {
  name: string;
  description: string;
  content: string;
  version: number;
}

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    name: 'update-title',
    description: 'Update the conversation title stored in the note frontmatter',
    version: 1,
    content: `The conversation title is stored as the \`conversation_title\` frontmatter property in the current conversation note.

To update it, use the \`update_frontmatter\` tool:
- First, use \`list\` with \`folderPath: "$steward/Conversations"\` to find the current conversation note
- Then set \`files\` to the path of the current conversation note
- Set \`properties\` to \`[{ name: "conversation_title", value: "<your new title>" }]\``,
  },
];
