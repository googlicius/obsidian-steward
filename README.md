# Steward

[![Build and Test](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml)

Steward is a plugin that utilizes Large Language Models (LLMs) to interact with your Obsidian Vault. It provides commands like `search`, `move`, `copy`, `create`, etc, as building blocks to create your own sophisticated commands, prompt chaining, and automation for your specific tasks.

## Features

- **Built-in Search Engine**: A TF-IDF based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search
- **Command-based Interaction**: Support for standard commands like search, create, update, delete, move, audio, image generation, and user-defined commands
- **Multi-language Support**: Use Steward in your preferred language
- **Privacy-focused**: Most actions are executed in the front-end using Obsidian API to avoid exposing your data to LLMs (except for your queries)
- **Interactive and Adaptive Chat UI**: A chat interface made of the slash `/` leveraging Obsidian's editor features and is adaptable to your current themes.
- **Model Flexibility**: Use your favorite AI models including OpenAI, DeepSeek, and Ollama local models
- **Intent Caching**: Utilizes embeddings to cache similar queries, so subsequent requests require fewer tokens for LLM processing.
- **User-Defined Commands**: Create your own command workflows by combining multiple commands with specific LLM models and settings of your choice.

## Standard (Built-In) Commands

Steward can be used through the command palette directly in the editor or by opening the chat interface.

### Usage

1. Click the "Open Steward chat" icon to open the chat
2. Type after the `/ ` in the chat or the active editor to interact or type `/ ?` to see available commands
3. To add a new line in the command input, press `Shift+Enter` (uses 2-space indentation)

#### Example Commands

- **/search** Notes tagged #Todo in the root folder
- / Add tag #Done to all notes of the search results and move them to the Archived folder
- / Write a poem about Angular in a new note then move it to the Generated folder
- / Update the list above to a numbered list
- **/audio** "project" as a noun and a verb using 11Labs

## Showcases

### Update directly in the editor

<img src="/docs/Update-In-Editor.gif" alt="Update directly in the editor" width="400px">

### Image read

<img src="/docs/Image-Read.gif" alt="Image read" width="650px">

### Update the selection

<img src="/docs/Stw-Demo-Update-selected-text.gif" alt="Update selection" width="650px">

### Search

<img src="/docs/Stw-Demo-Search-light.gif" alt="Search" width="650px">

## User-Defined Commands

You can create your own **User-Defined Commands** to automate workflows and combine multiple built-in or other User-Defined commands into a single, reusable command.

### How It Works

- User-Defined Commands are defined as YAML blocks in markdown files inside the `Steward/Commands` folder.
- Each command can specify a sequence of built-in or user-defined commands to execute.
- You can specify if user input is required for your command using the `query_required` field.
- These commands are available with autocomplete and are processed just like built-in commands.

### Example: User-Defined Command YAML

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
  - `system_prompt`: The system prompts that allows you to add additional guidelines to LLMs to the current command
  - `query`: (required if the `query_required` is true, string) The query to send to LLMs, put the `$from_user` as a placeholder for your input
  - `model`: (optional, string) The model to use for this specific command step (overrides the command-level model)

### Using Links in System Prompts

You can reference the content of other notes in your vault by using Obsidian links in the `system_prompt` array:

```yaml
command_name: search_with_context
description: Search with predefined context
query_required: true
commands:
  - name: search
    system_prompt:
      - '[[My Context Note]]'
      - Additional instructions
    query: $from_user
```

When the command is executed:

1. The link `[[My Context Note]]` will be replaced with the actual content of that note
2. This allows you to maintain complex prompts or contexts in separate notes
3. You can update the linked notes independently of your command definition

### Usage

1. Create a note in `Steward/Commands` and add your command YAML in a code block.
2. In any note or the Chat, type your command (e.g., `/clean_up #Todo`) and press Enter.
3. The command will execute the defined sequence, using your input if required.

### Validation

- The system validates your User-Defined Command YAML:
  - `command_name` must be a string
  - `commands` must be a non-empty array
  - If present, `query_required` must be a boolean
  - Each command step must have a `name` (string) and `query` (string)
- If validation fails, the command will not be loaded and an error will be logged.

### Creating Commands with LLM Assistance

You can ask Steward to help create user-defined commands using natural language, even without knowing YAML syntax:

1. Simply share the [User-Defined Command Guidelines](docs/User-Defined%20Command%20Guidelines.md) with Steward
2. Describe what you want your command to do in plain language
3. Steward will create commands with the proper YAML structure for you
4. Review, modify if needed, and save to your Commands folder

#### User-Defined command creation with LLM helps:

<img src="/docs/User-Defined-command-creation.gif" alt="User-Defined command creation" width="650px">

#### Another Real-World User-Defined command:

<img src="/docs/Flashcard-Assist-command.gif" alt="Flashcard Assist" width="650px">

### Command Flow Visualization

The following diagram illustrates how commands are processed in Steward:

<img src="/docs/commands-flow.svg" alt="Commands flow" width="600px">

## Folder Structure

Steward creates the following folder structure in your vault:

```
Steward/
├── Commands/       # Stores user-defined command definitions
├── Conversations/  # Archives past conversations
└── Steward Chat.md # Current active conversation
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

## TODOs

- [x] Multiple lines command.
- [ ] Reminder.
- [ ] Steward can provide information about its functionalities, limitations,...
- [x] Provide any information, usage, and guidance about Obsidian.
- [ ] Autocompletion and automation.
- [x] User-defined commands and actions
- [ ] Traceability
- [ ] MCP support.
