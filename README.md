# Obsidian Steward

Obsidian Steward is a plugin that utilizes Large Language Models (LLMs) to interact with your Obsidian Vault. It provides building block commands like search, move, copy, create, and more, allowing you to build sophisticated custom prompts, prompt chaining, and automation for your specific tasks.

## Features

- **Built-in Search Engine**: Powerful TF-IDF based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search
- **Command-based Interaction**: Support for commands like search, create, update, delete, move, audio, and image generation
- **Multi-language Support**: Use Steward in your preferred language
- **Privacy-focused**: Most actions are executed in the front-end using Obsidian API to avoid exposing your data to LLMs (except for your queries)
- **Beautiful Chat UI**: Interactive chat interface that leverages Obsidian's editor support
- **Model Flexibility**: Use your favorite AI models including OpenAI, DeepSeek, and Ollama local models
- **Intent Caching**: Utilizes embeddings to cache similar queries so subsequent requests don't require LLM processing

## Development Status

🚧 **Active Development** 🚧

This plugin is currently under active development. New features and improvements are being added regularly. While the core functionality is stable, you might encounter occasional issues or changes as development progresses. Feedback and bug reports are welcome!

## Usage

Steward can be used through the command palette or by opening the chat interface. Here are some example commands:

- `Search for notes about project management`
- `Create a new note about quantum physics`
- `Move the search results to the Projects folder`
- `Generate an image of a mountain landscape`
- `Create an audio summary of the selected text`

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

- **Conversation Folder**: The folder where conversation notes will be stored (default: `Steward/Conversations`)
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
