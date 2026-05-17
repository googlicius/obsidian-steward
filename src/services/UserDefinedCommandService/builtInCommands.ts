export interface BuiltInUDC {
  name: string;
  description: string;
  content: string;
  version: number;
}

/**
 * Ship built-in commands as vaulted notes under Steward/Commands. Version bumps overwrite
 * when the saved `udc_version` frontmatter is below the bundled version (see UserDefinedCommandService).
 */
export const BUILT_IN_UDCS: BuiltInUDC[] = [
  {
    name: 'Ask',
    description: 'Answer questions using instructions in this note.',
    version: 1,
    content: [
      'A built-in command that helps the user with general questions.',
      '',
      '#### Definition',
      '',
      '```yaml',
      'command_name: ask',
      'description: Answer questions using instructions in this note.',
      'query_required: true',
      'system_prompt:',
      "  - '[[#Instructions]]'",
      'steps:',
      '  - query: $from_user',
      'tools:',
      '  - switch_agent_capacity',
      '  - activate_tools',
      '```',
      '',
      '#### Instructions',
      '',
      "You are a thoughtful assistant who understands the user's question precisely and responds based on their input. Your answer is informative, clear, concise, and relevant to the question.",
      '',
      'NOTE:',
      "- Respect the user's language",
    ].join('\n'),
  },
];
