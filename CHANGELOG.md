# Changelog

All notable changes to Obsidian Steward will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.7.3] - 2026-04-26

### Added

- **SHELL tool** for models
- **UDC**: Allow multiple UDC definitions in a single markdown file

### Changed

- **Datasource**: Path completion and source-ref handling
- **CLI**: `isInteractiveCliCommand` — a query is treated as an interactive command when it contains a supported interactive program
- **Agents**: Keep the agent loop continuing for model-made shell calls

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.7.2...2.7.3)

## [2.7.2] - 2026-04-25

### Changed

- **CLI**: Improve xterm state preservation on embed remount. Replaces `ptyScrollback` with xterm serialization via `@xterm/addon-serialize`, which captures full terminal state (screen content, cursor position, scroll offset) instead of only raw PTY output, for better UX when navigating away and back to an interactive CLI embed.

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.7.1...2.7.2)

## [2.7.1] - 2026-04-24

### Changed

- **CLI**: Restore terminal after navigating back

### Fixed

- **CLI**: Two-way scroll sync for embedded terminals

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.7.0...2.7.1)

## [2.7.0] - 2026-04-18

### Added

- **CLI**: Local CLI bridge (`/>`) for running shell commands.
- **CLI**: Node-pty integration and xterm.js-based interactive terminal sessions (second-build bundle, prebuilt installers, PowerShell installer path, Shell caption).
- **CLI**: Ctrl+C keybinding to interrupt CLI sessions.
- **CLI**: Start remote sessions only when a command needs interactive mode; hide the stream marker when the stream completes; probe `cd` commands to track the session working directory.
- **Chat**: Move the chat view between the main editor and the right sidebar.

### Changed

- **TODO**: Consolidate `TODO_LIST` and `TODO_LIST_UPDATE` into `TODO_WRITE`.
- **UDC**: Template engine support for user-defined command definitions.
- **Agents**: Google model tool schemas; support for pre-activated tools from UDC declarations.
- **Conversation**: `deleteMessageById` and improved STW metadata parsing.
- **MCP**: Discover and cache MCP tool names; offline stub tools for unavailable servers.

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.6.0...2.7.0)

## [2.6.0] - 2026-04-06

### Added

- **MCP (Model Context Protocol)**: Add MCP capacity to integrate with external MCP servers.
- **Validation status in frontmatter**: Write validation status to frontmatter for user-defined commands.

### Changed

- **Command input**: Fixed continuation lines after leading tabs; aligned paste prefix check.
- **User-defined commands**: Improved handling of continuation line deletion.
- **Built-in providers**: Removed DeepSeek and Groq as built-in providers.
- **Settings**: Added settings migration framework for future version upgrades.

### Refactored

- Moved model selection section to settings; moved GIF to README.assets folder.

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.5.1...2.6.0)

## [2.5.1] - 2026-03-26

### Changed

- Add a user message before the creating to-do list tool call.
- **Command input**: ArrowDown newline on last line; Backspace merge continuation.

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.5.0...2.5.1)

## [2.5.0] - 2026-03-22

### Added

- **Performance**: Defer AI-SDK parsing to improve startup time.

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.4.0...2.5.0)

## [2.4.0] - 2026-03-18

### Added

- **Revert multiple operations**: Revert multiple operations from the latest user query.
- **SubAgent**: New SubAgent system for spawning dedicated agents with specific capabilities.
- **SPAWN_SUBAGENT tool**: Tool to spawn subagents for specialized tasks.
- **Conversation title in embed**: Update embed title with generated `conversation_title` from frontmatter.

### Changed

- **User-defined commands**: Replaced `use_tool` with `tools` (explicit Super Agent tool allowlist). Omit `tools` for the full set; use `[switch_agent_capacity]` for chat-only until the user switches. Legacy `use_tool` in `.md` definitions is migrated on load (e.g. `false` → `tools: [switch_agent_capacity]`). Conversation frontmatter uses `allowed_tools` instead of `use_tool`.
- **SuperAgent system prompt**: Task guidance is built from the active tool set; `switch_agent_capacity` guidelines describe direct-response vs full-agent mode.
- **Skills**: Replaced `use_skills` tool with `read_content`—skills are now read on demand by path instead of being activated and persisted. Simpler flow with fewer moving parts.
- **Command input**: Show current model and provider in the input for better visibility.
- **Guardrails**: Refactored grep tool handling, moved existence checking to a separate tool (`vaultExists`).
- **History view**: Enhanced history view with improved UI; don't show subagent notes in history.
- **VaultCreate**: Can now create empty folders.
- **VaultList**: Improved rendering and search behavior; block search if blocklist is set.
- **Dynamic handler**: Handle `no_stool_error` more gracefully.
- **Edit review**: Updated for generic use across different operations.
- **Help view**: Now lists disabled rules and skills for better visibility.
- **Title agent**: Added another channel to set conversation title via tool schemas.

### Fixed

- Fixed conversation indicators using DOM events instead of file content to avoid mixing indicator and generating content.

## [2.3.0] - 2026-03-06

### Added

- **Conversation Compaction**: Added conversation compaction to keep long chats performant while preserving full-message recall.
- **Guardrails**: Added Guardrails support to restrict file and folder access with rule-based protections.
- **Switch to agent capacity tool**: Added a new tool to switch agent capacity directly from command flow.

### Changed

- Updated thinking block rendering to apply a max-height for better readability in long responses.

### Fixed

- Fixed broken placeholder text in the command input on mobile.

## [2.2.0] - 2026-02-24

### Added

- **Command Syntax - Tool Calling Without AI**: Execute tools directly without AI interpretation for faster and more predictable command execution.
- **Search - Multiple Operators Support**: Search frontmatter fields using comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`.
- **Search - Relative Date Queries**: Use natural date expressions like `today`, `yesterday`, `last month`, etc. in search queries.
- **Conversation History**: View and manage past conversation threads with titles.
- **Tool call content streaming**: Stream tool content in the conversation to demonstrate what Steward is working on instead of showing the loading indicator.

### Changed

- Refactored command syntax parser for improved maintainability and extensibility.
- Updated conclude tool to remove the conclusion field for more streamlined conversation endings.
- Command syntax manual tool-calling steps now managed through to-do list.
- History items now use native `<a>` tags for better navigation.

### Updated

- UDC (User-Defined Command) skill file with latest improvements.

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.1.0...2.1.1)

## [2.1.0] - 2026-02-11

### Added

- **Agent Skills**: Extend Steward with domain-specific knowledge by placing skill files in the `Steward/Skills` folder. Skills are activated automatically or on demand, and persist across conversations. Compatible with the Agent Skills specification.
- Conclude tool: Steward now concludes conversations more efficiently, avoiding an extra processing step just for the conclusion.
- Built-in User-defined command skill available at [Steward Skills](https://github.com/googlicius/obsidian-steward/tree/main/skills)
- Wiki documentation: [Steward wiki](https://github.com/googlicius/obsidian-steward/wiki)

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.6...2.1.0)

## [2.0.6] - 2026-02-07

### Changed

- Suffix provider to duplicate model options
- Build search index from folders
- Keep stopwords while tokenizing if it passes the threshold
- Build search index `manualToolcall` only static clusters

### Fixed

- File names that close to the keyword should have a higher score
- App freezes when searching for tags

### Added

- Use secret storage for API keys

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.5...2.0.6)

## [2.0.5] - 2026-01-28

### Added

- Plan command
- Search by terms that are included in a camelCase or PascalCase
- Versioning guidelines and documents

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.4...2.0.5)

## [2.0.4] - 2026-01-25

### Changed

- Replace the TF-IDF with the BM25 algorithm for scoring
- Expose scoring parameters to search settings
- Add technical search documentation

### Fixed

- Static classifies require API key
- Leading and trailing apostrophes and underscores
- Throw errors when system prompts cannot be resolved

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.3...2.0.4)

## [2.0.3] - 2026-01-23

### Added

- Auto-scroll while streaming ([#115](https://github.com/googlicius/obsidian-steward/pull/115))
- Auto-scroll toggle button, inject root-level system prompts ([#116](https://github.com/googlicius/obsidian-steward/pull/116))
- Replace by pattern edit mode ([#117](https://github.com/googlicius/obsidian-steward/pull/117))
- Revert edits ([#117](https://github.com/googlicius/obsidian-steward/pull/117))
- Read multiple notes by pattern ([#119](https://github.com/googlicius/obsidian-steward/pull/119))
- Guidelines and placeholder ([#121](https://github.com/googlicius/obsidian-steward/pull/121))

### Changed

- Update Steward folder setting ([#121](https://github.com/googlicius/obsidian-steward/pull/121))

### Fixed

- Invalid tool call ([#120](https://github.com/googlicius/obsidian-steward/pull/120))

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.2...2.0.3)

## [2.0.2] - 2026-01-15

### Added

- Confirmation buttons ([#109](https://github.com/googlicius/obsidian-steward/pull/109))
- Edit table mode ([#111](https://github.com/googlicius/obsidian-steward/pull/111))
- Hume speech provider ([#112](https://github.com/googlicius/obsidian-steward/pull/112))

### Changed

- Allow select models in UDC ([#110](https://github.com/googlicius/obsidian-steward/pull/110))
- Update setting UI - group items ([#114](https://github.com/googlicius/obsidian-steward/pull/114))
- Activate tools fields are strings ([#110](https://github.com/googlicius/obsidian-steward/pull/110))

### Fixed

- Language issues ([#109](https://github.com/googlicius/obsidian-steward/pull/109))
- Todo-list created by UDC-agent or AI ([#109](https://github.com/googlicius/obsidian-steward/pull/109))
- Model doesn't update when selecting a model ([#110](https://github.com/googlicius/obsidian-steward/pull/110))
- Anthropic CORS ([#111](https://github.com/googlicius/obsidian-steward/pull/111))
- Content required ([#111](https://github.com/googlicius/obsidian-steward/pull/111))
- ElevenLabs ([#112](https://github.com/googlicius/obsidian-steward/pull/112))

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.1...2.0.2)

## [2.0.1] - 2026-01-06

### Changed

- `findFile`: Scan files when search index is not built

### Fixed

- Use the `textEmbeddingModel` function for Ollama provider
- Use static clusters when embedding isn't configured properly or disabled
- Patch the ai `warnings.length` error

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/2.0.0...2.0.1)

## [2.0.0] - 2026-01-03

### Major Changes

#### Autonomous Agent

Migrated from an extraction-based system that processed tasks sequentially to a fully autonomous agent architecture. The new system uses a single primary agent (SuperAgent) that intelligently activates and uses tools to accomplish tasks. This makes Steward more capable and efficient at handling complex workflows.

#### Data Awareness Agent

Added DataAwarenessAgent for tasks that require input awareness and processing large numbers of files. The SuperAgent can delegate these specialized tasks to the DataAwarenessAgent, which processes files in batches to avoid token limits while maintaining context awareness.

#### Custom Provider Support

You can now add custom LLM providers directly from the settings. This allows you to use any OpenAI, Google, DeepSeek, etc, compatible API endpoints with your own configuration.

#### User-Defined Command Improvements

Version 2 is now the default version for user-defined commands. For commands with multiple steps, the system uses a to-do list to track each step and provide additional data such as system prompts and models. You can also use a one-step command with a complex query and let Steward decide the steps automatically. The command definition has been simplified by removing system modification and tool exclusion options.

### Added

- Super agent that can activate and use multiple tools
- Vault, Search, Edit, and Revert agents as tools
- AI-SDK 5 migration ([#100](https://github.com/googlicius/obsidian-steward/pull/100))
- Custom provider support ([#102](https://github.com/googlicius/obsidian-steward/pull/102))
- TailwindCSS integration ([#102](https://github.com/googlicius/obsidian-steward/pull/102))
- System prompt at the root level for user-defined commands ([#103](https://github.com/googlicius/obsidian-steward/pull/103))
- One-step UDCs processing ([#103](https://github.com/googlicius/obsidian-steward/pull/103))
- Hidden-from-user messages ([#103](https://github.com/googlicius/obsidian-steward/pull/103))
- Heading-only wikilinks for UDCs ([#105](https://github.com/googlicius/obsidian-steward/pull/105))

### Changed

- User-defined command to UDCAgent migration ([#100](https://github.com/googlicius/obsidian-steward/pull/100))
- AI-SDK 6 migration ([#102](https://github.com/googlicius/obsidian-steward/pull/102))
- Remove system prompt modifier ([#101](https://github.com/googlicius/obsidian-steward/pull/101))
- Keep the last AI turn reasoning contents instead of the last AI message ([#104](https://github.com/googlicius/obsidian-steward/pull/104))

### Fixed

- Handle invalid or dynamic tool call ([#100](https://github.com/googlicius/obsidian-steward/pull/100))
- Command input paste ([#101](https://github.com/googlicius/obsidian-steward/pull/101))
- Read content ([#101](https://github.com/googlicius/obsidian-steward/pull/101))
- Folder suggestion ([#102](https://github.com/googlicius/obsidian-steward/pull/102))
- Invocation count reset after fallback ([#104](https://github.com/googlicius/obsidian-steward/pull/104))

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/1.2.3...2.0.0)

## [1.2.3] - 2025-12-11 (Pre-release)

### Added

- Large data set vault operations ([#96](https://github.com/googlicius/obsidian-steward/pull/96))

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/1.2.2...1.2.3)

## [1.2.2] - 2025-12-08

### Added

- Non-reasoning content search ([#87](https://github.com/googlicius/obsidian-steward/pull/87))
- Delete a property by setting null ([#87](https://github.com/googlicius/obsidian-steward/pull/87))
- New version announcement ([#88](https://github.com/googlicius/obsidian-steward/pull/88))
- Revert agent ([#90](https://github.com/googlicius/obsidian-steward/pull/90))
- Providers setting ([#91](https://github.com/googlicius/obsidian-steward/pull/91))
- Revert rename ([#92](https://github.com/googlicius/obsidian-steward/pull/92))
- VaultList by file name pattern ([#92](https://github.com/googlicius/obsidian-steward/pull/92))
- Revert create ([#93](https://github.com/googlicius/obsidian-steward/pull/93))

### Changed

- Simple revert without AI ([#93](https://github.com/googlicius/obsidian-steward/pull/93))
- Move folders to another folder ([#93](https://github.com/googlicius/obsidian-steward/pull/93))
- Remove deleted embedding clusters ([#92](https://github.com/googlicius/obsidian-steward/pull/92))

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/1.2.1...1.2.2)

## [1.2.1] - 2025-11-30

### Added

- New version announcement ([#88](https://github.com/googlicius/obsidian-steward/pull/88))
- Non-reasoning content search ([#87](https://github.com/googlicius/obsidian-steward/pull/87))
- Delete a property by setting null ([#87](https://github.com/googlicius/obsidian-steward/pull/87))

### Changed

- Update word-processor command

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/1.2.0...1.2.1)

## [1.2.0] - 2025-11-25

### Added

- User-defined command definition version 2 ([#77](https://github.com/googlicius/obsidian-steward/pull/77))
- Inline model: Show current model, update the setting, and autocomplete
- Command-builder to community UDC ([#79](https://github.com/googlicius/obsidian-steward/pull/79))
- Vault and Planner agents ([#81](https://github.com/googlicius/obsidian-steward/pull/81))
- Update-frontmatter tool ([#83](https://github.com/googlicius/obsidian-steward/pull/83))
- Threshold for stopwords removal
- Abort requests by pressing ESC
- Reasoning capacity ([#85](https://github.com/googlicius/obsidian-steward/pull/85))

### Changed

- Rework on create command - use tool ([#80](https://github.com/googlicius/obsidian-steward/pull/80))

[Full Changelog](https://github.com/googlicius/obsidian-steward/compare/1.0.12...1.2.0)

---

## Release Links

- [Latest Release](https://github.com/googlicius/obsidian-steward/releases/latest)
- [All Releases](https://github.com/googlicius/obsidian-steward/releases)
