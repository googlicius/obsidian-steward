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
   - `/calc` - Perform calculations with natural language
2. Press `Shift+Enter` to execute the command and start a conversation

3. The plugin will:

   - Create a new note in the conversations folder
   - Insert an inline link to that note at your current cursor position
   - Initialize the conversation with your command

4. To continue the conversation, type `/me <your follow-up>` below the inline link and press `Shift+Enter`

## Example

```markdown
# Meeting Notes

Let's organize the vocabulary flashcards.

/move files have tag #noun to English/Vocabulary/Nouns folder

![[move command 2h894g3]]

/me Thank you
```

## Installation

1. Download the plugin from the Obsidian Community Plugins browser
2. Enable the plugin in your Obsidian settings
3. Configure your OpenAI API key in the plugin settings

## Settings

- **OpenAI API Key**: Your API key for accessing OpenAI services
- **Conversation Folder**: The folder where conversation notes will be stored (default: `conversations`)

## Development

This plugin uses TypeScript and follows the Obsidian plugin architecture.

### Building

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start the development server
4. Run `npm run build` to build the production version

## License

MIT
