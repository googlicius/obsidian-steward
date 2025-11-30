# Steward

[![Build and Test](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml)

Steward is a plugin that utilizes Large Language Models (LLMs) to interact with your Obsidian Vault. It provides commands like `search`, `move`, `copy`, `create`, etc, as building blocks to create your own sophisticated commands, prompt chaining, and automation for your specific tasks.

## Features

- **Built-in search engine**: A TF-IDF based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search.
- **Interactive and adaptive chat UI**: One or more chat interfaces made of the slash `/` leveraging Obsidian's editor and reading view features, that is, adaptable to your current themes.
- **Privacy-focused**: Most actions are executed in the front-end using Obsidian API and local services to avoid exposing your data to LLMs (except for your queries and what you're explicitly provided).
- **Command-based interaction**: Support for standard commands like search, create, update, delete, move, audio, image generation, and user-defined commands.
- **Model flexibility**: Use your favorite AI models, including OpenAI, Gemini, DeepSeek, Ollama, etc.
- **Model fallback**: Automatically switches to alternative models when errors occur, ensuring robust command execution.
- **Intent caching**: Utilizes embeddings to cache similar queries, so subsequent requests require fewer tokens for LLM processing.
- **Multi-language support**: Use Steward in your preferred language.
- **User-defined commands**: Create your own command workflows by combining multiple commands with specific LLM models and settings of your choice.

## Table of contents

- [Features](#features)
- [Standard (built-in) commands](#standard-built-in-commands)
  - [Usage](#usage)
  - [Showcases](#showcases)
- [User-defined commands](#user-defined-commands)
  - [How it works](#how-it-works)
  - [Definitions](#definitions)
  - [Usage](#usage-1)
  - [Example: user-defined command definition](#example-user-defined-command-definition)
  - [Customizing system prompts](#customizing-system-prompts)
  - [Excluding tools](#excluding-tools)
  - [Automated command triggers](#automated-command-triggers)
  - [Creating commands with LLM assistance](#creating-commands-with-llm-assistance)
  - [User-defined command showcases](#user-defined-command-showcases)
- [Command flow visualization](#command-flow-visualization)
- [Folder structure](#folder-structure)
- [Installation](#installation)
- [Development](#development)
- [Contributing](#contributing)
  - [Code contributions](#code-contributions)
  - [User-defined commands](#user-defined-commands-1)
- [License](#license)

## Standard (built-in) commands

Steward can be used directly in the editor or by opening the chat interface.

### Usage

1. Click the "Open Steward chat" icon to open the chat
2. Type after the `/ ` in the chat or the active editor to interact or type `/ ?` to see available commands
3. To add a new line in the command input, press `Shift+Enter` (uses 2-space indentation)
4. To change the model, in the input, type `m:` or `model:` and select from the dropdown.
5. To stop a running command, press `ESC` key or type `stop` in the command input.

### Showcases

#### Update directly in the editor

<img src="/docs/Update-In-Editor.gif" alt="Update directly in the editor" width="400px">

#### Image read

<img src="/docs/Image-Read.gif" alt="Image read" width="650px">

#### Reasoning

<img src="/docs/Steward-Demo-Reasoning.gif" alt="Image read" width="400px">

#### Update the selection

<img src="/docs/Stw-Demo-Update-selected-text-complex.gif" alt="Update selection" width="650px">

#### Search

<img src="/docs/Stw-Demo-Search-light.gif" alt="Search" width="650px">

## User-defined commands

You can create your own **User-Defined Commands** to automate workflows and combine multiple built-in or other User-Defined commands into a single, reusable command.

### How it works

- User-Defined Commands are defined as YAML blocks in markdown files inside the `Steward/Commands` folder.
- Each command can specify a sequence of built-in or user-defined commands to execute.
- You can specify if user input is required for your command using the `query_required` field.
- These commands are available with autocomplete and are processed just like built-in commands.

### Definitions

- `command_name`: The name you will use to invoke the command (e.g., `/clean_up`)
- `query_required`: (optional, boolean) If true, the command requires user input after the prefix
- `model`: (optional, string) The model to use for all commands in this user-defined command
- `hidden`: (optional, boolean) If true, the command will not appear in the command menu
- `triggers`: (optional, array) Automatically execute commands when files match specified criteria (see [Trigger fields](#trigger-fields))
- `commands`: The sequence of built-in or user-defined commands to execute
  - `system_prompt`: (optional, array) Modify the system prompt for this command (see [Customizing system prompts](#customizing-system-prompts))
  - `query`: (required if the `query_required` is true, string) The query to send to LLMs, put the `$from_user` as a placeholder for your input
  - `model`: (optional, string) The model to use for this specific command step (overrides the command-level model)
  - `no_confirm`: (optional, boolean) If true, skips confirmation prompts for this command step
  - `tools`: (optional, object) Control which tools are available for this command step (see [Excluding tools](#excluding-tools))
    - `exclude`: (optional, array) Array of tool names to exclude from this command step

### Usage

1. Create a note in `Steward/Commands` and add your command YAML in a code block.
2. In any note or the Chat, type your command (e.g., `/clean_up #Todo`) and press Enter.
3. The command will execute the defined sequence, using your input if required.

### Example: user-defined command definition

```yaml
command_name: clean_up
description: Clean up the vault
query_required: false
model: gpt-4o # Optional: Specify a default model for all commands
commands:
  - name: search
    query: 'Notes name starts with Untitled or with tag #delete'

  - name: vault_delete
    query: Delete them
    model: gpt-3.5-turbo # Optional: Override the model for this specific step
```

### Customizing system prompts

You can customize the system prompt for any command step using the `system_prompt` field. This allows you to modify the AI's behavior for specific commands without completely replacing the base prompt.

#### Simple format (strings)

Add additional instructions that will be handled separately:

```yaml
commands:
  - name: generate
    system_prompt:
      - '[[My Context Note]]' # Link to a note (content will be included)
      - 'Focus on technical details'
      - 'Provide examples'
    query: $from_user
```

#### Advanced format (modifications)

Modify specific parts of the base system prompt using operations:

**Remove a guideline:**

```yaml
commands:
  - name: read
    system_prompt:
      - mode: remove
        pattern: 'Read ALL notes at once'
    query: Read the content
```

**Modify a guideline:**

```yaml
commands:
  - name: read
    system_prompt:
      - mode: modify
        pattern: 'Read ALL notes at once'
        replacement: 'Read notes one at a time'
        matchType: partial # Options: partial, exact, regex (default: partial)
    query: $from_user
```

**Add new content:**

```yaml
commands:
  - name: generate
    system_prompt:
      - mode: add
        content: 'You MUST use the generateContent tool to stream content.'
        pattern: 'Use.*when you need clarification' # Optional: insert after this line
    query: $from_user
```

#### Match types

When using `remove` or `modify` mode, you can specify how to match patterns:

- `partial` (default): Matches if the pattern appears anywhere in the line
- `exact`: Matches only if the entire line equals the pattern
- `regex`: Treats the pattern as a regular expression

Example:

```yaml
system_prompt:
  - mode: remove
    pattern: 'Read.*notes' # Regex pattern
    matchType: regex
```

#### Using links in system prompts

Reference the content of other notes in your vault using Obsidian links:

```yaml
command_name: search_with_context
commands:
  - name: search
    system_prompt:
      - '[[My Context Note]]'
      - '[[Another Context]]'
    query: $from_user
```

When executed:

1. The link `[[My Context Note]]` will be replaced with the actual content of that note
2. This allows you to maintain complex prompts or contexts in separate notes
3. You can update the linked notes independently of your command definition

#### Practical examples

**Sequential Reading (instead of parallel):**

```yaml
command_name: sequential_read
commands:
  - name: read
    system_prompt:
      - mode: modify
        pattern: 'Read ALL notes at once'
        replacement: 'Read notes one at a time sequentially'
    query: Read $from_user
```

**Remove Confirmation Requirements:**

```yaml
command_name: no-confirm-read
commands:
  - name: read
    system_prompt:
      - mode: remove
        pattern: 'MUST use confirmation BEFORE reading the entire'
    query: Read the entire note $from_user
```

You can also skip confirmation prompts for individual command steps using the `no_confirm` field.

### Excluding tools

You can exclude specific tools from being available in a command step using the `tools.exclude` field. This removes both the tool from the LLM's available tools and automatically removes related guidelines from the system prompt.

#### Available tool names

- `contentReading` - Read content from notes
- `confirmation` - Get user confirmation before actions
- `askUser` - Ask the user for additional information
- `requestReadContent` - Request the read command for more data
- `grep` - Search for text patterns in notes
- `edit` - Update content in notes

#### Example

Exclude specific tools from a command step:

```yaml
commands:
  - name: read
    tools:
      exclude: ['confirmation', 'askUser']
    query: Read the entire content
```

This example:

1. Removes `confirmation` and `askUser` tools from the LLM's available tools
2. Automatically removes all guidelines mentioning these tools from the system prompt

#### Notes on `no_confirm` vs excluding the confirmation tool

- Excluding the `confirmation` tool removes it from the LLM's available tools only. The model cannot call it.
- `no_confirm: true` does two things:
  1. It removes the `confirmation` and `askUser` tools from the LLM's tool set (same effect as excluding the tool), and
  2. It also disables the in-app confirmation flow for that command step.

### Automated command triggers

User-Defined Commands can be configured to automatically execute when specific file events occur, enabling powerful automation workflows.

#### Trigger configuration

Add a `triggers` array to your command definition to specify when the command should automatically execute:

```yaml
command_name: inbox_processor
query_required: false
triggers:
  - events: [create]
    folders: ['Inbox']
  - events: [modify]
    patterns:
      tags: ['#process']
      status: 'pending'
commands:
  - name: read
    query: 'Read the content of $file_name'
  - name: generate
    query: 'Categorize and suggest improvements'
```

#### Trigger fields

- `events`: (required, array) List of events to watch: `create`, `modify`, `delete`
- `folders`: (optional, array) Folder paths to watch (e.g., `["Inbox", "Daily Notes"]`)
- `patterns`: (optional, object) Pattern matching criteria (all must match):
  - `tags`: Tags to match (e.g., `["#todo", "#review"]` or `"#todo"`)
  - `content`: Regex pattern to match file content
  - Any frontmatter property name (e.g., `status: "draft"`, `priority: ["high", "urgent"]`)

#### Placeholders in triggers

When a command is triggered, you can use these placeholders:

- `$file_name`: The name of the note that triggered the command

#### Practical examples

**Tag-based workflow:**

```yaml
triggers:
  - events: [modify]
    patterns:
      tags: '#flashcard-gen'
```

**Property-Based workflow:**

```yaml
triggers:
  - events: [modify]
    patterns:
      status: 'draft'
      type: 'article'
```

**Content pattern matching:**

```yaml
triggers:
  - events: [modify]
    patterns:
      content: '\\[ \\]|TODO:|FIXME:'
```

#### How triggers work

1. When a file event occurs (create/modify/delete), the system checks all trigger conditions
2. For `modify` events, the system waits for metadata cache to update, then checks if patterns are newly added
3. If all patterns match and are new (for modify events), a conversation note is created automatically
4. The triggered command executes in this conversation note

### Creating commands with LLM assistance

You can ask Steward to help create user-defined commands using natural language, even without knowing YAML syntax:

1. Simply share the [User-Defined Command Guidelines](docs/User-Defined%20Command%20Guidelines.md) with Steward
2. Describe what you want your command to do in plain language
3. Steward will create commands with the proper YAML structure for you
4. Review, modify if needed, and save to your Commands folder

### User-defined command showcases

#### User-defined command creation with LLM helps:

<img src="/docs/User-Defined-command-creation.gif" alt="User-Defined command creation" width="650px">

#### Flashcard assist:

<img src="/docs/Flashcard-Assist-command.gif" alt="Flashcard Assist" width="650px">

#### Automated command

<img src="/docs/Steward-Demo-Auto-trigger.gif" alt="Flashcard Assist" width="650px">

### Command flow visualization

The following diagram illustrates how commands are processed in Steward:

<img src="/docs/commands-flow.svg" alt="Commands flow" width="600px">

## Folder structure

Steward creates the following folder structure in your vault:

```
Steward/
├── Commands/       # Stores user-defined command definitions
├── Conversations/  # Archives past conversations
├── Trash/          # Stores deleted files
└── Steward chat.md # Current active conversation
```

## Installation

### From Obsidian Community Plugins

1. Download the plugin from the Obsidian Community Plugins browser
2. Enable the plugin in your Obsidian settings
3. Configure your API keys in the plugin settings

### Using BRAT (Beta Reviewer's Auto-update Tool)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian Community Plugins
2. Open BRAT settings and add the beta plugin: `googlicius/obsidian-steward`
3. Enable the plugin in your Obsidian settings
4. Configure your API keys in the plugin settings

### Manual installation

1. Download the latest release from the [releases page](https://github.com/googlicius/obsidian-steward/releases)
2. Extract the zip file into your Obsidian vault's `.obsidian/plugins` folder
3. Enable the plugin in your Obsidian settings
4. Configure your API keys in the plugin settings

## Development

This plugin uses TypeScript and follows the Obsidian plugin architecture.

### Building

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the production version

## Contributing

Contributions to Steward are welcome! Here's how you can contribute:

### Code contributions

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### User-defined commands

You can contribute your User-Defined Commands (UDCs) to help the community:

1. Create your UDC following the guidelines in the [User-Defined Command section](#user-defined-commands)
2. Test your UDC thoroughly to ensure it works as expected
3. Add your UDC to the `community-UDCs` folder with a descriptive name
4. Include clear documentation in your UDC file explaining:
   - What the command does
   - How to use it
   - Any prerequisites or dependencies
   - Example usage scenarios

Check out existing commands in the `community-UDCs` folder like `flashcard-assist.md` for reference.

## License

MIT
