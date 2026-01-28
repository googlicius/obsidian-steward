# Steward

[![Build and Test](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml)

English | [Tiếng Việt](README_VI.md)

Steward is a plugin that utilizes Large Language Models (LLMs) to interact with your Obsidian Vault. It offers very fast search, seamless vault management, and powerful automation capabilities. Designed with simplicity and an immersive AI experience in mind, Steward lets you create your own sophisticated commands and workflows to automate your boring and repetitive tasks.

## Features

- **Built-in search engine**: A BM25-based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search.
- **Interactive and adaptive chat UI**: One or more chat interfaces made of the slash `/` leveraging Obsidian's editor and reading view features, that is, adaptable to your current themes.
- **Privacy-focused**: Most actions are executed in the front-end using Obsidian API and local services to avoid exposing your data to LLMs (except for your queries and what you're explicitly provided).
- **Command-based interaction**: Support for standard commands like search, vault (list, create, delete, copy, move, rename, update frontmatter), update, audio, image generation, and user-defined commands.
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
  - [Adding additional system prompts](#adding-additional-system-prompts)
  - [Automated command triggers](#automated-command-triggers)
  - [User-defined command showcases](#user-defined-command-showcases)
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
5. To stop a running command, press `ESC` key or type `Stop` in the command input.
6. To revert changes, type `Undo` in the command input.

### Showcases

#### Update directly in the editor

<img src="/docs/Update-In-Editor.gif" alt="Update directly in the editor" width="400px">

#### Reasoning

<img src="/docs/Steward-Demo-Reasoning-2.gif" alt="Image read" width="400px">

#### To-do list and revert changes

<img src="/docs/Steward-Demo-Todo-list-and-revert.gif" alt="Revert" width="400px">

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
- `system_prompt`: (optional, array) Add additional system prompts that apply to all steps in this command (see [Adding additional system prompts](#adding-additional-system-prompts))
- `use_tool`: (optional, boolean) If false, do not send the tool usage instructions
- `hidden`: (optional, boolean) If true, the command will not appear in the command menu
- `triggers`: (optional, array) Automatically execute commands when files match specified criteria (see [Trigger fields](#trigger-fields))
- `steps`: The sequence of built-in or user-defined commands to execute
  - `name`: (optional, string) The step name (e.g., `read`, `edit`, `search`, `vault`, `generate`, etc.). This automatically activates the corresponding tools for this step. NOTE: Uses `generate` if you want the AI to respond directly without using tools.
  - `system_prompt`: (optional, array) Add additional system prompts for this command step (see [Adding additional system prompts](#adding-additional-system-prompts))
  - `query`: (required if the `query_required` is true, string) The query to send to AIs, put the `$from_user` as a placeholder for your input
  - `model`: (optional, string) The model to use for this specific command step (overrides the command-level model)
  - `no_confirm`: (optional, boolean) If true, skips confirmation prompts for this command step

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
steps:
  - name: search
    query: 'Notes name starts with Untitled or with tag #delete'

  - name: vault
    query: 'Delete them'
    model: gpt-3.5-turbo # Optional: Override the model for this specific step
```

### Adding additional system prompts

Steward uses a single agent (SuperAgent) whose core system prompt is the foundation of its functionality and is not editable. However, you can add additional system prompts using the `system_prompt` field. These additional prompts are appended to the core system prompt, allowing you to provide extra context or instructions. You can disable sending the core system prompt by setting `use_tool: false`.

You can add system prompts at two levels:

- **Root level**: Applies to all steps in the command
- **Step level**: Applies only to that specific step (root-level prompts are applied first, then step-level prompts)

Add additional instructions as an array of strings:

**Root-level system prompt (applies to all steps):**

```yaml
command_name: my_command
system_prompt:
  - '[[#Guidelines]]' # Link to the Guidelines heading (content under the heading will be included)
  - 'Always use formal language'
steps:
  - query: |
    Read the content above and help me with:
    $from_user
```

**Step-level system prompt (applies only to specific steps):**

```yaml
steps:
  - name: generate
    system_prompt:
      - '[[My Context Note]]' # Link to a note (content will be included)
      - 'Focus on technical details'
      - 'Provide examples'
    query: $from_user
```

#### Using links in system prompts

Reference the content of other notes in your vault using Obsidian links:

```yaml
command_name: search_with_context
steps:
  - name: search
    system_prompt:
      - '[[Search instruction]]' # The content of the "Search instruction" note will be included as the system prompt.
      - '[[Some note#Instructions]]' # Only the content under the Instructions heading of "Some note" will be included as the system prompt.
      - '[[#Instructions]]' # Only the content under the Instructions heading of the current note will be included as the system prompt.
    query: $from_user
```

When executed:

1. The link `[[Search instruction]]` will be replaced with the full content of that note
2. The link `[[Some note#Instructions]]` will be replaced with only the content under the "Instructions" heading in that note
3. The link `[[#Instructions]]` will be replaced with only the content under the "Instructions" heading in the **current note** where the User-defined command is defined.
4. You can update the linked notes independently of your command definition

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
steps:
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

- `$file_name` - The file name that triggered a command.
- `$from_user` - User input.
- `$steward` - Steward folder.

#### How triggers work

1. When a file event occurs (create/modify/delete), the system checks all trigger conditions
2. For `modify` events, the system waits for metadata cache to update, then checks if patterns are newly added
3. If all patterns match and are new (for modify events), a conversation note is created automatically
4. The triggered command executes in this conversation note

### Downloadable resources

Guidelines and community User-defined commands can be downloaded directly from the [Steward repository](https://github.com/googlicius/obsidian-steward). When fetched, guidelines are stored in `Steward/Docs/` and commands are stored in `Steward/Commands/` in your vault. Type `/ Help` or `/ ? ` in the chat to access available guidelines and community commands.

### User-defined command showcases

#### Flashcard assist:

<img src="/docs/Flashcard-Assist-command.gif" alt="Flashcard Assist" width="650px">

#### Automated command [Word processor](/community-UDCs/Word%20processor.md)

<img src="/docs/Steward-Demo-Automated.gif" alt="Flashcard Assist" width="650px">

### Community user-defined commands

The [community-UDCs](/community-UDCs/) folder contains user-defined commands contributed by the community. These commands showcase the flexibility of user-defined commands, allowing you to create custom interaction modes tailored to your needs.

Example commands:

- [Ask](/community-UDCs/ask.md) - Ask questions without making changes to your vault
- [Plan](/community-UDCs/Plan.md) - Plan and outline tasks before execution
- [Clean up](/community-UDCs/Clean%20up.md) - Clean up your vault by removing unwanted notes
- [Word processor](/community-UDCs/Word%20processor.md) - Process and format text in your notes

Feel free to use these as inspiration for creating your own commands!

## Folder structure

Steward creates the following folder structure in your vault:

```
Steward/
├── Commands/       # Stores user-defined command definitions
├── Conversations/  # Archives past conversations
├── Docs/           # Fetched documents from this repo
├── Release notes/  # Release notes of Steward
├── Trash/          # Stores deleted files
└── Steward chat.md # Current active conversation
```

## Installation

### From Obsidian Community Plugins

1. Download the plugin from the Obsidian Community Plugins browser
2. Enable the plugin in your Obsidian settings
3. Configure your API keys in the plugin settings

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

## License

MIT
