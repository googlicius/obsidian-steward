import { LATEST_COMMANDS_BRANCH } from 'src/generated/communityUdcManifest';

export interface BuiltInUDC {
  name: string;
  description: string;
  content: string;
  version: number;
}

/**
 * Ship built-in commands as vaulted notes under Steward/Commands. Version bumps overwrite
 * when the saved `version` frontmatter is below the bundled version (see UserDefinedCommandService).
 */
export const BUILT_IN_UDCS: BuiltInUDC[] = [
  {
    name: 'Ask',
    description: 'Answer questions using instructions in this note.',
    version: 2,
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
      'tools: [activate_tools, switch_agent_capacity]',
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
  {
    name: 'Update command',
    description:
      'Install or update a community Steward command note into Steward/Commands from a JSON guideline.',
    version: 9,
    content: [
      'This command is auto-generated into your Steward/Commands folder. Use to install or upgrade a community command, expect the query to be a valid JSON.',
      '',
      '#### Definition',
      '',
      '```yaml',
      'command_name: update-command',
      'description: Install or update community command markdown under Steward/Commands using a guideline payload.',
      'query_required: true',
      'cli:',
      '  whitelist:',
      '    - "pwd"',
      'system_prompt:',
      "  - '[[#Instructions]]'",
      'steps:',
      '  - query: $from_user',
      'tools: [shell, list, delete, move]',
      '```',
      '',
      '#### Instructions',
      '',
      'You install or upgrade **published community user-defined commands markdown**. The query is in JSON format.',
      '',
      'Expected JSON keys:',
      '- `files`: string[], paths relative to the plugin repo root (e.g. `community-UDCs/Video/Explain video.md`).',
      '- `destinationFolder`: optional subdirectory under `Commands` (e.g. `Video`). Omit for flat files.',
      '- `version`: number for the bundled package (stored in the installed note frontmatter).',
      '- `mainVAULT_FILENAME`: basename of the **primary UDC-defining note** (e.g. `Explain video.md`).',
      '- `commandName`: slug reference only.',
      '',
      '',
      `Raw URL base (<raw_url_base>): **\`https://raw.githubusercontent.com/googlicius/obsidian-steward/${LATEST_COMMANDS_BRANCH}/\`**`,
      '',
      'Follow these steps:',
      '',
      '1. **Parse the JSON query** to extract `files`, `destinationFolder`, `version`, and `mainVAULT_FILENAME`.',
      '',
      '2. **Get the vault absolute path** — Run `pwd` via **`shell`** to obtain the vault root directory.',
      '',
      '3. **Download into `$steward/tmp`** — For every path in `files`, derive `<filename>` from the basename of that path (e.g. `Explain video.md`). Use **`shell`** to fetch and write only under tmp:',
      '   - Unix/Mac: `curl -fsSL "<raw_url_base><repo_path_as_url>" -o "<vault_path>/$steward/tmp/<filename>"`',
      '   - Windows: `Invoke-WebRequest -Uri "<raw_url_base><repo_path_as_url>" -OutFile "<vault_path>/$steward/tmp/<filename>"`',
      '*Note: Put **`%20` in the download URL wherever a path segment has a space** (not in the quoted local `-o` / `-OutFile` path).*',
      '',
      '4. Delete the existing file(s) (Those are the same name as the downloaded file(s)) in the `$steward/Commands` before moving.',
      '',
      '5. **Move into `$steward/Commands`** — Use the **`move`** tool for all downloaded file only: from `$steward/tmp/<filename>` to `$steward/Commands/<filename>` when `destinationFolder` is omitted, or `$steward/Commands/<destinationFolder>/<filename>` when it is set.',
      '',
      'NOTE:',
      '- Do NOT download or write files directly under `$steward/Commands`; Obsidian vault events (create / modify / delete / rename) will not run and command(s) will not be registered or refreshed.',
      '- Do NOT create `$steward/tmp`; that folder already exists.',
      '- Stop if the query is not or invalid JSON.',
    ].join('\n'),
  },
];
