# Steward

[![Build and Test](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml/badge.svg)](https://github.com/googlicius/obsidian-steward/actions/workflows/ci.yml)

English | [Tiếng Việt](README_VI.md)

Steward is an autonomous AI agent for Obsidian, powered by Large Language Models (LLMs). Equipped with tools and skills, it can search, manage your vault, and handle specialized tasks like creating Bases or Canvas files. Designed with simplicity and an immersive AI experience in mind, Steward lets you create your own commands, skills, and workflows to automate your boring and repetitive tasks.

## Features

- **Built-in search engine**: A BM25-based search with relevant scoring and typo tolerance that is significantly faster than the native Obsidian search.
- **Agent Skills**: Extend Steward with domain-specific knowledge for specialized tasks like creating Obsidian Bases, Canvas files, or your own workflows. Compatible with the [Agent Skills specification](https://agentskills.io/specification).
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
- [Skills](#skills)
- [User-defined commands](#user-defined-commands)
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

## Skills

Skills give Steward domain-specific knowledge for specialized tasks. Each skill is a markdown file in the `Steward/Skills` folder with frontmatter (`name`, `description`) and body content that gets injected into the AI's context when activated.

Skills are activated automatically when the AI detects a relevant task, or you can ask explicitly:

```
/ Use the obsidian-bases skill to create a table view of my project notes.
```

Once activated, skills persist for the entire conversation and across app restarts.

You can find ready-to-use skills from the community, such as [Obsidian Skills](https://github.com/kepano/obsidian-skills) for Bases, Canvas, and Markdown. Download skill files and place them in your `Steward/Skills` folder to get started.

For more details, see the [Skills wiki](https://github.com/googlicius/obsidian-steward/wiki/Skills).

<img src="/docs/Skills.gif" alt="Skills" width="650px">

## User-defined commands

You can create your own **User-Defined Commands** to automate workflows and combine multiple built-in or other User-Defined commands into a single, reusable command. Commands are defined as YAML blocks in markdown files inside the `Steward/Commands` folder, and they're available with autocomplete just like built-in commands.

For the full guide on creating and using User-Defined Commands, see the [User-defined commands wiki](https://github.com/googlicius/obsidian-steward/wiki/User-defined-commands).

### Showcases

#### Flashcard assist:

<img src="/docs/Flashcard-Assist-command.gif" alt="Flashcard Assist" width="650px">

#### Automated command [Word processor](/community-UDCs/Word%20processor.md)

<img src="/docs/Steward-Demo-Automated.gif" alt="Flashcard Assist" width="650px">

### Community user-defined commands

The [community-UDCs](/community-UDCs/) folder contains user-defined commands contributed by the community:

- [Ask](/community-UDCs/ask.md) - Ask questions without making changes to your vault
- [Plan](/community-UDCs/Plan.md) - Plan and outline tasks before execution
- [Clean up](/community-UDCs/Clean%20up.md) - Clean up your vault by removing unwanted notes
- [Word processor](/community-UDCs/Word%20processor.md) - Process and format text in your notes

## Folder structure

Steward creates the following folder structure in your vault:

```
Steward/
├── Commands/       # Stores user-defined command definitions
├── Conversations/  # Archives past conversations
├── Docs/           # Fetched documents from this repo
├── Release notes/  # Release notes of Steward
├── Skills/         # Agent skills for domain-specific knowledge
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

1. Create your UDC following the [User-defined commands wiki](https://github.com/googlicius/obsidian-steward/wiki/User-defined-commands)
2. Test your UDC thoroughly to ensure it works as expected
3. Add your UDC to the `community-UDCs` folder with a descriptive name
4. Include clear documentation in your UDC file explaining:
   - What the command does
   - How to use it
   - Any prerequisites or dependencies
   - Example usage scenarios

## License

MIT
