This guideline shows you how to create custom commands that automate workflows and combine multiple built-in or user-defined commands.

## How it works

User-defined commands are YAML blocks in markdown files inside the `Steward/Commands` folder. Each command can specify a sequence of steps to execute. These commands are available with autocomplete and work just like built-in commands.

## Basic structure

Create a note in `Steward/Commands` and add your command YAML in a code block:

```yaml
command_name: clean-up
query_required: false
model: gpt-4o # Optional: Specify a default model for all steps
steps:
  - name: search
    query: 'Notes name starts with Untitled or with tag #delete'
  - name: vault
    query: 'Delete them'
    model: gpt-3.5-turbo # Optional: Override the model for this specific step
```

For commands that require user input:

```yaml
command_name: ask
query_required: true
use_tool: false
system_prompt:
  - '[[#Instructions]]'
steps:
  - query: '$from_user'
```

## Key fields

### Command-level fields

- `command_name`: The name to invoke your command (e.g., `/clean-up`)
- `query_required`: (optional, boolean) If true, the command requires user input after the prefix
- `model`: (optional, string) The model to use for all steps in this command
- `system_prompt`: (optional, array) Add additional system prompts that apply to all steps in this command (see [[#Adding system prompts]])
- `use_tool`: (optional, boolean) If false, do not send the tool usage instructions
- `hidden`: (optional, boolean) If true, the command will not appear in the command menu
- `triggers`: (optional, array) Automatically execute commands when files match specified criteria (see [[#Automated triggers]])
- `steps`: The sequence of built-in or user-defined commands to execute

### Step-level fields

- `name`: (optional, string) The step name (e.g., `read`, `edit`, `search`, `vault`, `generate`, etc.). This automatically activates the corresponding tools for this step. Use `generate` if you want the AI to respond directly without using tools.
- `system_prompt`: (optional, array) Add additional system prompts for this command step (see [[#Adding system prompts]])
- `query`: (required if `query_required` is true, string) The query to send to Steward. Use `$from_user` as a placeholder for user input
- `model`: (optional, string) The model to use for this specific command step (overrides the command-level model)
- `no_confirm`: (optional, boolean) If true, skips confirmation prompts for this command step

## Adding system prompts

Add additional instructions using `system_prompt` at the command or step level:

```yaml
command_name: my_command
system_prompt:
  - '[[#Guidelines]]' # Link to a heading in the current note
  - 'Always use formal language'
steps:
  - query: |
    Read the content above and help me with:
    $from_user
```

**Step-level system prompt:**

```yaml
steps:
  - name: generate
    system_prompt:
      - '[[My Context Note]]' # Link to a note (content will be included)
      - 'Focus on technical details'
      - 'Provide examples'
    query: $from_user
```

The `system_prompt` field accepts an array of strings. Each string can be:

- **Text**: Plain text instructions (e.g., `'Always use formal language'`)
- **Link**: Obsidian links to include note content:
  - `[[Note Name]]` - Full content of the note
  - `[[Note Name#Heading]]` - Content under a specific heading
  - `[[#Heading]]` - Content under a heading in the current note

> [!INFO] Tips
>
> Link system prompts to a heading in the current note (e.g., `[[#Instructions]]`) to keep your prompts alongside the command definition. This makes editing easier and lets you use full markdown formatting.

## Automated triggers

Commands can automatically execute when file events occur, for example:

```yaml
command_name: generate_flashcards
query_required: false

triggers:
  - events: [modify]
    patterns:
      tags: '#flashcard-gen'

steps:
  - name: read
    query: 'Read the content of $file_name'
  - name: edit
    query: |
      Generate flashcards from this note content.
      Format each flashcard as:
      Q: [question]
      A: [answer]
      ---
      Append the flashcards at the end of the note under a "## Flashcards" heading.
```

Trigger fields:

- `events`: List of events to watch: `create`, `modify`, `delete`
- `folders`: (optional) Folder paths to watch
- `patterns`: (optional) Pattern matching criteria:
  - `tags`: Tags to match
  - `content`: Regex pattern to match file content
  - Any frontmatter property name

## Placeholders

- `$file_name` - The file name that triggered a command.
- `$from_user` - User input.
- `$steward` - Steward folder.

These placeholders will be replaced with the actual values when the command is executing.

## Community commands

Try these ready-to-use commands from the community. Click any link to fetch and install the command in your `Steward/Commands` folder:

> [!INFO] Example commands
>
> [Ask](obsidian://steward-resource?type=command&name=ask) - A command that helps with general questions
> [Plan](obsidian://steward-resource?type=command&name=Plan) - Create a detailed plan (to-do list) and ask for user confirmation before executing
> [Clean up](obsidian://steward-resource?type=command&name=Clean%20up) - Clean up conversation notes in the Steward/Conversations folder (_This is an example of a multiple-step command_)
> [Flashcard ask](obsidian://steward-resource?type=command&name=Flashcard%20ask) - Help with tasks from the flashcard above the cursor
> [Word processor](obsidian://steward-resource?type=command&name=Word%20processor) - Process newly added English words or phrases. (_This is an example of an automated command_)

When you click a link, the command will be fetched from GitHub and stored in your `Steward/Commands` folder. You can then use it like any other user-defined command.
