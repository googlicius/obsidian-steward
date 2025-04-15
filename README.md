# Obsidian Steward

Obsidian Steward is a plugin for [Obsidian](https://obsidian.md) that helps you communicate with an AI assistant directly from your markdown editor.

## Features

- **Command-based conversations**: Start a conversation with the AI by typing special commands like `/move`, `/search`, or `/calc`
- **Contextual AI assistance**: Get help with moving files, searching your vault, or performing calculations
- **Persistent conversations**: All conversations are saved in a dedicated folder for future reference
- **Follow-up queries**: Easily continue conversations with follow-up messages

## Usage

1. Type one of the following commands at the beginning of a line:
   - `/move` - Get help moving files in your vault
   - `/search` - Search your vault with natural language
2. Press `Shift+Enter` to execute the command and start a conversation

3. The plugin will:

   - Create a new note in the conversations folder
   - Insert an inline link to that note at your current cursor position
   - Initialize the conversation with your command

## Installation

1. Download the plugin from the Obsidian Community Plugins browser
2. Enable the plugin in your Obsidian settings
3. Configure your OpenAI API key in the plugin settings

## Settings

- **OpenAI API Key**: Your API key for accessing OpenAI services
- **Conversation Folder**: The folder where conversation notes will be stored (default: `steward/conversations`)

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
- [ ] Search in one or many specific folders.
- [ ] Command options: `--help`, `--model`, `--explain`,...
- [ ] The reversion of command's actions.
- [ ] Reminder.
- [ ] Steward can provide information about its functionalities, limitations,...
- [ ] Provide any information, usage, and guidance about Obsidian.
- [ ] Autocompletion and automation.
- [ ] Unused media actions: Move or remove.
- [ ] Cache previous generated contents.
- [x] Respect user's language.
- [ ] User-defined commands and actions, for example: Don't do anything if not entering the correct password.
- [ ] User confirmation when the AI is unsure about its response.
- [ ] User confirmation when the AI performs a large side effect action.
- [ ] Traceability
- [ ] MCP support.
- [ ] Build more sophisticated commands make it able to users to modify even predefined commands the way they want.
