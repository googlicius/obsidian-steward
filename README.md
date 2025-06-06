# Steward

Steward is a plugin that utilizes Large Language Models (LLMs) to interact with your Obsidian Vault. It provides commands like `search`, `move`, `copy`, `create`, etc, as building blocks for building your own sophisticated commands, prompt chaining, and automation for your specific tasks.

## Features

- **Built-in Search Engine**: A TF-IDF based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search
- **Command-based Interaction**: Support for standard commands like search, create, update, delete, move, audio, image generation, and user-defined commands
- **Multi-language Support**: Use Steward in your preferred language
- **Privacy-focused**: Most actions are executed in the front-end using Obsidian API to avoid exposing your data to LLMs (except for your queries)
- **Interactive Chat UI**: An interactive chat interface using your current theme that leverages Obsidian's editor features to input any supported Markdown syntax. You can start a conversation, whether in the Chat sidebar or directly in the current editor.
- **Model Flexibility**: Use your favorite AI models including OpenAI, DeepSeek, and Ollama local models
- **Intent Caching**: Utilizes embeddings to cache similar queries so subsequent requests don't require LLM processing

## Development Status

🚧 **Active Development** 🚧

This plugin is currently under active development. New features and improvements are being added regularly. While the core functionality is stable, you might encounter occasional issues or changes as development progresses. Feedback and bug reports are welcome!

## Standard (Built-In) Commands

Steward can be used through the command palette directly in the editor or by opening the chat interface. Here are some example commands:

### Usage

- **/search** Notes tagged #Todo in the root folder
- / Add tag #Done to all notes of the search results and move them to the Archived folder
- / Write a poem about Angular in a new note then move it to the Generated folder
- / Update the list above to a numbered list
- **/audio** "project" as a noun and a verb using 11Labs
- / I don't like your name, you are "Joe" from now on

### Tips to reduce the number of input tokens

- Use a specific command directly instead of a general command (`/ `), e.g, `/search`, `/audio`, etc.
- For the `/search` command, wrap the keyword in quotation marks for searching the vault without the LLM's help, e.g, `/search "my cat"`
- Provide feedback by clicking thumbs up or down on any Steward's answer to help it classify accurately #Todo.

## User-Defined Commands

You can create your own **User-Defined Commands** to automate workflows and combine multiple built-in or other User-Defined commands into a single, reusable command.

### How It Works

- User-Defined Commands are defined as JSON blocks in markdown files inside the `Steward/Commands` folder.
- Each command can specify a sequence of built-in or user-defined commands to execute.
- You can specify if user input is required for your command using the `query_required` field.
- These commands are available with autocomplete and are processed just like built-in commands.

### Example: User-Defined Command JSON

```json
{
	"command_name": "clean_up",
	"description": "Clean up the vault",
	"query_required": false,
	"commands": [
		{
			"name": "search",
			"system_prompt": ["Notes in the root folder"],
			"query": "Notes name start with Untitled"
		},
		{
			"name": "delete_from_artifact",
			"query": "Delete them"
		}
	]
}
```

- `command_name`: The name you will use to invoke the command (e.g., `/clean_up`)
- `query_required`: (optional, boolean) If true, the command requires user input after the prefix
- `commands`: The sequence of built-in or user-defined commands to execute
  - `system_prompt`: The system prompts that allows to add additional guidelines to LLMs to the current command
  - `query`: (required if the `query_required` is true, string) The query to send to LLMs, put the `$from_user` as a placeholder for your input

### Usage

1. Create a note in `Steward/Commands` and add your command JSON in a code block.
2. In any note or the Chat, type your command (e.g., `/clean_up #Todo`) and press Enter.
3. The command will execute the defined sequence, using your input if required.

### Validation

- The system validates your User-Defined Command JSON:
  - `command_name` must be a string
  - `commands` must be a non-empty array
  - If present, `query_required` must be a boolean
  - Each command step must have a `name` (string) and `query` (string)
- If validation fails, the command will not be loaded and an error will be logged.

### Why User-Defined Commands?

- Automate repetitive tasks
- Create macros for your workflow
- Share and reuse command sequences

## Installation

1. Download the plugin from the Obsidian Community Plugins browser
2. Enable the plugin in your Obsidian settings
3. Configure your API keys in the plugin settings

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

## License

MIT

## TODOs

- [ ] Multiple lines command.
- [x] Moving notes to multiple destinations.
- [x] Search in one or many specific folders.
- [ ] Command options: `--help`, `--model`, `--explain`,...
- [x] The reversion of command's actions.
- [ ] Reminder.
- [ ] Steward can provide information about its functionalities, limitations,...
- [ ] Provide any information, usage, and guidance about Obsidian.
- [ ] Autocompletion and automation.
- [ ] Unused media actions: Move or remove.
- [ ] Cache previous generated contents.
- [x] Respect user's language.
- [ ] User-defined commands and actions, for example: Don't do anything if not entering the correct password.
- [x] User confirmation or clarify when the AI is unsure about its response.
- [ ] User confirmation when the AI performs a large side effect action.
- [ ] Traceability
- [ ] MCP support.
- [x] Remember user's intent.
