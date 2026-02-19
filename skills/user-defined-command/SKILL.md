---
name: user-defined-command
description: Create and edit Steward user-defined commands (UDCs). Use when the user wants to create, modify, or troubleshoot custom command workflows defined as YAML in the Steward/Commands folder.
---

# User-Defined Command Skill

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

## Command Syntax (Direct Tool Calls)

Steps can use **command syntax** in the `query` field to invoke tools directly without an AI round trip. This is the preferred approach for deterministic operations.

### Syntax

```
c:<tool> [--arg=value]...
```

- `c:` prefix identifies a direct command call
- `<tool>` is a short alias (see reference below)
- `--key=value` pairs map to the tool's input schema
- Multiple commands can be chained with `;` separator: `c:read --blocks=1; c:conclude`
- Quoted values for strings with spaces: `--content="hello world"`
- Comma-separated values for arrays: `--files=Note1.md,Note2.md`

### Command Reference

| Alias        | Tool                 | Flags                                                               |
| ------------ | -------------------- | ------------------------------------------------------------------- |
| `c:read`     | Content Reading      | `--type`, `--files`, `--element`, `--blocks`, `--pattern`           |
| `c:search`   | Search               | `--keywords`, `--filenames`, `--folders`, `--properties`            |
| `c:delete`   | Delete               | `--artifact`, `--files`                                             |
| `c:list`     | List                 | `--folder`, `--pattern`                                             |
| `c:move`     | Move                 | `--artifact`, `--files`, `--destination`                            |
| `c:rename`   | Rename               | `--artifact`, `--pattern`, `--replace`                              |
| `c:grep`     | Grep                 | `--pattern`, `--paths`                                              |
| `c:speech`   | Speech               | `--text`                                                            |
| `c:image`    | Image                | `--prompt`                                                          |
| `c:conclude` | Conclude (stop)      |                                                                     |

### `c:read` Flags

| Flag         | Type     | Default | Description                                                                    |
| ------------ | -------- | ------- | ------------------------------------------------------------------------------ |
| `--type`     | string   | `above` | One of: `above`, `below`, `pattern`, `entire`, `frontmatter`                   |
| `--files`    | string[] | `[]`    | Comma-separated file names to read from                                        |
| `--artifact` | string   | —       | Artifact ID (or `latest`) to resolve file names from.                          |
| `--element`  | string   | `null`  | One of: `paragraph`, `table`, `code`, `list`, `blockquote`, `image`, `heading` |
| `--blocks`   | number   | `1`     | Number of blocks to read. Use `-1` for all content from current position       |
| `--pattern`  | string   | —       | RegExp pattern (required when `--type=pattern`)                                |

### `c:search` Flags

| Flag           | Type     | Description                                                                              |
| -------------- | -------- | ---------------------------------------------------------------------------------------- |
| `--keywords`   | string[] | Comma-separated search terms                                                             |
| `--filenames`  | string[] | Comma-separated file names to search for                                                 |
| `--folders`    | string[] | Comma-separated folder paths to search within                                            |
| `--properties` | json     | Property filters in `name:value` format, comma-separated (e.g. `tag:todo,status:active`) |

### `c:delete` Flags

| Flag         | Type     | Description                            |
| ------------ | -------- | -------------------------------------- |
| `--artifact` | string   | Artifact ID containing files to delete |
| `--files`    | string[] | Comma-separated file paths to delete   |
One of `--artifact` or `--files` is required.

### `c:list` Flags

| Flag        | Type   | Description                         |
| ----------- | ------ | ----------------------------------- |
| `--folder`  | string | Folder path to list files from      |
| `--pattern` | string | RegExp pattern to filter file names |

### `c:move` Flags

| Flag            | Type     | Description                          |
| --------------- | -------- | ------------------------------------ |
| `--artifact`    | string   | Artifact ID containing files to move |
| `--files`       | string[] | Comma-separated file paths to move   |
| `--destination` | string   | Destination folder path              |
One of `--artifact` or `--files` is required, along with `--destination`.

### `c:rename` Flags

| Flag         | Type   | Description                            |
| ------------ | ------ | -------------------------------------- |
| `--artifact` | string | Artifact ID containing files to rename |
| `--pattern`  | string | Pattern to match in file names         |
| `--replace`  | string | Replacement text for matched pattern   |

### `c:grep` Flags

| Flag        | Type     | Description                                          |
| ----------- | -------- | ---------------------------------------------------- |
| `--pattern` | string   | Text or RegExp pattern to search for in file content |
| `--paths`   | string[] | Comma-separated folder paths to search within        |

### Composing Steps

When composing UDC steps, prefer `c:` command syntax for **deterministic operations** to avoid unnecessary AI round trips. Reserve natural language queries for steps that require **AI reasoning** (e.g., content generation, summarization, complex editing decisions).

**Use command syntax when the step:**
- Reads content from a known location (`c:read`)
- Searches with specific criteria (`c:search`)
- Performs file operations: delete, move, rename, list, grep
- Generates speech or images from known text/prompts (`c:speech`, `c:image`)

**Use natural language when the step:**
- Needs AI to generate, summarize, or transform content
- Requires the AI to decide what to edit or how to structure output
- Involves complex reasoning about the content

When `c:` syntax is used, the step `name` is still recommended for tool activation but the query is parsed directly, bypassing the AI entirely.

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
- `$active_file` — The file path of the currently active file in the workspace

## Examples

### Simple multi-step command (with command syntax)

```yaml
command_name: clean-up
query_required: false
steps:
  - name: search
    query: 'c:search --keywords=Untitled --properties=tag:delete'
    no_confirm: true
  - name: vault
    query: 'c:delete --artifact=latest; c:conclude'
    no_confirm: true
```

### Simple multi-step command (natural language)

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

### Mixed: command syntax for read, natural language for AI-driven edit

```yaml
command_name: format-lists
query_required: false
steps:
  - name: read
    query: 'c:read --blocks=-1 --element=list'
    no_confirm: true
  - name: edit
    query: 'Format the list items from the previous step into a clean bulleted list'
    system_prompt:
      - 'Rewrite the list using consistent bullet formatting'
```

### Chaining multiple commands in a single step

```yaml
command_name: quick-search-delete
query_required: false
steps:
  - query: 'c:search --keywords=Untitled; c:delete --artifact=latest; c:conclude'
    no_confirm: true
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

### Automated trigger command (with command syntax for read)

```yaml
command_name: generate_flashcards
query_required: false

triggers:
  - events: [modify]
    patterns:
      tags: '#flashcard-gen'

steps:
  - name: read
    query: 'c:read --type=entire --files=$file_name; c:conclude'
    no_confirm: true
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
- When composing UDC steps, **prefer `c:` command syntax** for deterministic operations (read, search, delete, move, rename, list, grep, speech, image) to avoid unnecessary AI round trips. Reserve natural language queries for steps that require AI reasoning.
