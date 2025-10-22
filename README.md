# Steward

[![Build and Test](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml)

Steward is a plugin that utilizes Large Language Models (LLMs) to interact with your Obsidian Vault. It provides commands like `search`, `move`, `copy`, `create`, etc, as building blocks to create your own sophisticated commands, prompt chaining, and automation for your specific tasks.

## Features

- **Built-in Search Engine**: A TF-IDF based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search.
- **Interactive and Adaptive Chat UI**: One or more chat interfaces made of the slash `/` leveraging Obsidian's editor and reading view features, that is, adaptable to your current themes.
- **Privacy-focused**: Most actions are executed in the front-end using Obsidian API and local services to avoid exposing your data to LLMs (except for your queries and what you're explicitly provided).
- **Command-based Interaction**: Support for standard commands like search, create, update, delete, move, audio, image generation, and user-defined commands.
- **Model Flexibility**: Use your favorite AI models, including OpenAI, Gemini, DeepSeek, Ollama, etc.
- **Intent Caching**: Utilizes embeddings to cache similar queries, so subsequent requests require fewer tokens for LLM processing.
- **Multi-language Support**: Use Steward in your preferred language.
- **User-Defined Commands**: Create your own command workflows by combining multiple commands with specific LLM models and settings of your choice.

## Standard (Built-In) Commands

Steward can be used directly in the editor or by opening the chat interface.

### Usage

1. Click the "Open Steward chat" icon to open the chat
2. Type after the `/ ` in the chat or the active editor to interact or type `/ ?` to see available commands
3. To add a new line in the command input, press `Shift+Enter` (uses 2-space indentation)

## Showcases

### Update directly in the editor

<img src="/docs/Update-In-Editor.gif" alt="Update directly in the editor" width="400px">

### Image read

<img src="/docs/Image-Read.gif" alt="Image read" width="650px">

### Update the selection

<img src="/docs/Stw-Demo-Update-selected-text-complex.gif" alt="Update selection" width="650px">

### Search

<img src="/docs/Stw-Demo-Search-light.gif" alt="Search" width="650px">

## User-Defined Commands

You can create your own **User-Defined Commands** to automate workflows and combine multiple built-in or other User-Defined commands into a single, reusable command.

### How It Works

- User-Defined Commands are defined as YAML blocks in markdown files inside the `Steward/Commands` folder.
- Each command can specify a sequence of built-in or user-defined commands to execute.
- You can specify if user input is required for your command using the `query_required` field.
- These commands are available with autocomplete and are processed just like built-in commands.

### Example: User-Defined Command definition

```yaml
command_name: clean_up
description: Clean up the vault
query_required: false
model: gpt-4o # Optional: Specify a default model for all commands
commands:
  - name: search
    query: 'Notes name starts with Untitled or with tag #delete'

  - name: delete_from_artifact
    query: Delete them
    model: gpt-3.5-turbo # Optional: Override the model for this specific step
```

- `command_name`: The name you will use to invoke the command (e.g., `/clean_up`)
- `query_required`: (optional, boolean) If true, the command requires user input after the prefix
- `model`: (optional, string) The model to use for all commands in this user-defined command
- `commands`: The sequence of built-in or user-defined commands to execute
  - `system_prompt`: (optional) Modify the system prompt for this command (see below)
  - `query`: (required if the `query_required` is true, string) The query to send to LLMs, put the `$from_user` as a placeholder for your input
  - `model`: (optional, string) The model to use for this specific command step (overrides the command-level model)
  - `no_confirm`: (optional, boolean) If true, skips confirmation prompts for this command step

### Customizing System Prompts

You can customize the system prompt for any command step using the `system_prompt` field. This allows you to modify the AI's behavior for specific commands without completely replacing the base prompt.

#### Simple Format (Strings)

Add additional instructions that will be handled separately:

```yaml
commands:
  - name: read
    system_prompt:
      - '[[My Context Note]]' # Link to a note (content will be included)
      - 'Focus on technical details'
      - 'Provide examples'
    query: $from_user
```

#### Advanced Format (Modifications)

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
  - name: read
    system_prompt:
      - mode: add
        content: '- Prioritize code blocks when reading'
        pattern: 'Use.*when you need clarification' # Optional: insert after this line
    query: $from_user
```

#### Match Types

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

#### Using Links in System Prompts

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

#### Practical Examples

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

### Usage

1. Create a note in `Steward/Commands` and add your command YAML in a code block.
2. In any note or the Chat, type your command (e.g., `/clean_up #Todo`) and press Enter.
3. The command will execute the defined sequence, using your input if required.

### Automated Command Triggers

User-Defined Commands can be configured to automatically execute when specific file events occur, enabling powerful automation workflows.

#### Trigger Configuration

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

#### Trigger Fields

- `events`: (required, array) List of events to watch: `create`, `modify`, `delete`
- `folders`: (optional, array) Folder paths to watch (e.g., `["Inbox", "Daily Notes"]`)
- `patterns`: (optional, object) Pattern matching criteria (all must match):
  - `tags`: Tags to match (e.g., `["#todo", "#review"]` or `"#todo"`)
  - `content`: Regex pattern to match file content
  - Any frontmatter property name (e.g., `status: "draft"`, `priority: ["high", "urgent"]`)

#### Placeholders in Triggers

When a command is triggered, you can use these placeholders:

- `$file_name`: The name of the note that triggered the command

#### Practical Examples

**Tag-Based Workflow:**

```yaml
command_name: flashcard-gen

triggers:
  - events: [modify]
    patterns:
      tags: '#flashcard-gen'

commands:
  - name: read
    query: 'Read entire $file_name'
  - name: generate
    query: 'Generate flashcards from the $file_name'
  - name: update_from_artifact
    query: 'Append generated flashcards to the $file_name
```

**Property-Based Workflow:**

```yaml
command_name: draft_reviewer
triggers:
  - events: [modify]
    patterns:
      status: 'draft'
      type: 'article'
commands:
  - name: read
    query: 'Read article from $file_name'
  - name: generate
    query: 'Review the draft and provide feedback'
```

**Content Pattern Matching:**

```yaml
command_name: todo_detector
triggers:
  - events: [modify]
    patterns:
      content: '\\[ \\]|TODO:|FIXME:'
commands:
  - name: read
    query: 'Read content from $file_name'
  - name: generate
    query: 'Extract all TODO items and create a task list'
```

#### How Triggers Work

1. When a file event occurs (create/modify/delete), the system checks all trigger conditions
2. For `modify` events, the system waits for metadata cache to update, then checks if patterns are newly added
3. If all patterns match and are new (for modify events), a conversation note is created automatically
4. The triggered command executes in this conversation note

### Validation

- The system validates your User-Defined Command YAML:
  - `command_name` must be a string
  - `commands` must be a non-empty array
  - If present, `query_required` must be a boolean
  - Each command step must have a `name` (string) and `query` (string)
  - If present, `triggers` must be an array with:
    - Valid event types (`create`, `modify`, `delete`)
    - Optional `folders` array
    - Optional `patterns` object where each value is a string or array
    - `content` pattern must be a valid regular expression if present
- If validation fails, the command will not be loaded and an error will be logged.

### Creating Commands with LLM Assistance

You can ask Steward to help create user-defined commands using natural language, even without knowing YAML syntax:

1. Simply share the [User-Defined Command Guidelines](docs/User-Defined%20Command%20Guidelines.md) with Steward
2. Describe what you want your command to do in plain language
3. Steward will create commands with the proper YAML structure for you
4. Review, modify if needed, and save to your Commands folder

### User-Defined command showcases

#### User-Defined command creation with LLM helps:

<img src="/docs/User-Defined-command-creation.gif" alt="User-Defined command creation" width="650px">

#### Flashcard assist:

<img src="/docs/Flashcard-Assist-command.gif" alt="Flashcard Assist" width="650px">

#### Automated command

<img src="/docs/Steward-Demo-Auto-trigger.gif" alt="Flashcard Assist" width="650px">

### Command Flow Visualization

The following diagram illustrates how commands are processed in Steward:

<img src="/docs/commands-flow.svg" alt="Commands flow" width="600px">

## Folder Structure

Steward creates the following folder structure in your vault:

```
Steward/
├── Commands/       # Stores user-defined command definitions
├── Conversations/  # Archives past conversations
├── Trash/          # Stores deleted files
└── Steward chat.md # Current active conversation
```

## Installation

### From Obsidian Community Plugins (Waiting for approval)

1. Download the plugin from the Obsidian Community Plugins browser
2. Enable the plugin in your Obsidian settings
3. Configure your API keys in the plugin settings

### Using BRAT (Beta Reviewer's Auto-update Tool)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian Community Plugins
2. Open BRAT settings and add the beta plugin: `googlicius/obsidian-steward`
3. Enable the plugin in your Obsidian settings
4. Configure your API keys in the plugin settings

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/googlicius/obsidian-steward/releases)
2. Extract the zip file into your Obsidian vault's `.obsidian/plugins` folder
3. Enable the plugin in your Obsidian settings
4. Configure your API keys in the plugin settings

## Settings

- **API Keys**:

  - OpenAI API Key (for OpenAI models and embeddings)
  - ElevenLabs API Key (for audio generation)
  - DeepSeek API Key (for DeepSeek models)

- **LLM Settings**:

  - Chat Model: Choose between various models from OpenAI, DeepSeek, or Ollama
  - Temperature: Controls randomness in the output (0.0 to 1.0)
  - Ollama Base URL: For local Ollama models (default: http://localhost:11434)

- **Steward Folder**: The folder where Steward' related notes will be stored (default: `Steward`)
- **Debug Mode**: Enable detailed logging for troubleshooting

## Development

This plugin uses TypeScript and follows the Obsidian plugin architecture.

### Building

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the production version

## Contributing

Contributions to Steward are welcome! Here's how you can contribute:

### Code Contributions

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### User-Defined Commands

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
