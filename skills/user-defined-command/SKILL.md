---
name: user-defined-command
description: Create and edit Steward user-defined commands (UDCs). Use when the user wants to create, modify, or troubleshoot custom command workflows defined as YAML in the Steward/Commands folder.
---

# User-Defined Command

This skill enables you to create and edit valid Steward user-defined commands — YAML-based command definitions stored as markdown files in the `Steward/Commands` folder.

## File Format

Each command is a markdown file (`.md`) containing one or more YAML code blocks. The file can also contain plain text, headings, and other markdown content that can be referenced by system prompts.

## YAML Schema

### Command-Level Fields

| Field            | Type                     | Required | Description                                                                              |
| ---------------- | ------------------------ | -------- | ---------------------------------------------------------------------------------------- |
| `command_name`   | string                   | **Yes**  | The name (In kebab-case) to invoke the command (e.g., `clean-up` invoked as `/clean-up`) |
| `query_required` | boolean                  | No       | If `true`, the command requires user input after the prefix. Default: `false`            |
| `model`          | string                   | No       | Default model for all steps (e.g., `gpt-4o`, `gemini-2.5-flash`)                         |
| `system_prompt`  | array of strings         | No       | Additional system prompts applied to all steps                                           |
| `use_tool`       | boolean                  | No       | If `false`, disables the core tool usage instructions                                    |
| `hidden`         | boolean                  | No       | If `true`, the command does not appear in the autocomplete menu                          |
| `triggers`       | array of trigger objects | No       | Automatically execute when file events match criteria                                    |
| `steps`          | array of step objects    | **Yes**  | The sequence of steps to execute                                                         |

### Step-Level Fields

| Field           | Type             | Required    | Description                                                                                                                                                         |
| --------------- | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | string           | No          | Step name that activates corresponding tools: `read`, `edit`, `search`, `vault`, `generate`, `image`, `speech`. Use `generate` for direct AI response without tools |
| `query`         | string           | Conditional | The query to send. Required if `query_required` is `true`. Use `$from_user` as placeholder for user input                                                           |
| `system_prompt` | array of strings | No          | Additional system prompts for this step only                                                                                                                        |
| `model`         | string           | No          | Model override for this step                                                                                                                                        |
| `no_confirm`    | boolean          | No          | If `true`, skips confirmation prompts for this step                                                                                                                 |

### Trigger Fields

| Field                 | Type             | Required | Description                                               |
| --------------------- | ---------------- | -------- | --------------------------------------------------------- |
| `events`              | array of strings | **Yes**  | Events to watch: `create`, `modify`, `delete`             |
| `folders`             | array of strings | No       | Folder paths to watch (e.g., `["Inbox", "Daily Notes"]`)  |
| `patterns`            | object           | No       | Pattern matching criteria (all must match)                |
| `patterns.tags`       | string or array  | No       | Tags to match (e.g., `"#todo"` or `["#todo", "#review"]`) |
| `patterns.content`    | string           | No       | Regex pattern to match file content                       |
| `patterns.<property>` | string or array  | No       | Any frontmatter property name and value to match          |

## System Prompt Values

The `system_prompt` field accepts an array of strings. Each string can be:

- **Plain text**: Direct instructions (e.g., `'Always use formal language'`)
- **Wiki link to a note**: `'[[Note Name]]'` — includes the full content of that note
- **Wiki link to a heading**: `'[[Note Name#Heading]]'` — includes content under that heading only
- **Wiki link to local heading**: `'[[#Heading]]'` — includes content under a heading in the current command file

## Placeholders

These placeholders are replaced with actual values at execution time:

- `$from_user` — The user's input text
- `$file_name` — The file name that triggered the command (for triggered commands)
- `$steward` — The Steward folder path

## Examples

### Simple multi-step command

```yaml
command_name: clean-up
query_required: false
model: gpt-4o
steps:
  - name: search
    query: 'Notes name starts with Untitled or with tag #delete'
  - name: vault
    query: 'Delete them'
    model: gpt-3.5-turbo
```

### Question-answering command with system prompt

```yaml
command_name: ask
query_required: true
use_tool: false
system_prompt:
  - '[[#Instructions]]'
steps:
  - query: '$from_user'
```

### Command with step-level system prompts

```yaml
command_name: summarize
query_required: true
steps:
  - name: generate
    system_prompt:
      - '[[My Context Note]]'
      - 'Focus on key takeaways'
      - 'Use bullet points'
    query: $from_user
```

### Automated trigger command

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

### Hidden command (not shown in autocomplete)

```yaml
command_name: internal-helper
hidden: true
query_required: true
steps:
  - name: generate
    query: $from_user
```

## Rules

- Note name should use sentence case: capitalize the first letter with spaces between words (e.g., `Clean up vault.md`).
- Do NOT add any heading at the beginning of the note. A short introduction should be the first content in the file.
- The YAML block MUST be inside a fenced code block with the `yaml` language tag.
- `command_name` and `steps` are always required.
- Step `name` determines which tools are available. Omitting `name` uses the default tool set.
- When `query_required` is `true`, at least one step must use `$from_user` in its `query`.
- When `use_tool` is `false`, the core system prompt with tool instructions is not sent — useful for pure conversational commands.
- System prompts and instructions referenced via `[[#Heading]]` should be placed BELOW the YAML code block, not above it.
- System prompts with wiki links are resolved at execution time. If a linked note or heading does not exist, an error occurs and the command will stop.
- For triggered commands, ensure the `query` in steps uses `$file_name` to reference the triggering file.
- Multiple triggers can be defined; any matching trigger will execute the command.
- A command file can contain multiple YAML code blocks, each defining a separate command.
- Markdown content outside YAML blocks (headings, text, lists) can be referenced by system prompts using `[[#Heading]]` syntax.
