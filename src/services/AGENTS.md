# src/services/ — Business Logic Layer

Business logic for Steward. Services do not wire conversation UI directly (except `CommandInputService` for editor input). Command/agent orchestration lives in `src/solutions/commands/`; search and artifacts live in `src/solutions/`.

## Related Code Outside This Folder

| Name              | Path                                          |
| ----------------- | --------------------------------------------- |
| ArtifactManagerV2 | `src/solutions/artifact/ArtifactManagerV2.ts` |
| SearchService     | `src/solutions/search/searchService.ts`       |

## Service Categories

### LLM / AI

| Service                | Path                       | Role                                                                            |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| LLMService             | `LLMService/LLMService.ts` | AI SDK provider factory, streaming, JSON repair, model context-length lookup    |
| ModelFallbackService   | `ModelFallbackService.ts`  | Tracks/alternates models in conversation frontmatter on failures                |
| CompactionTokenService | `CompactionTokenService/`  | Shrinks tool results in history when prompt tokens exceed ~80% of model context |

### Conversation Notes

| Service                  | Path                          | Role                                                                                    |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------- |
| ConversationRenderer     | `ConversationRenderer/`       | Reads/writes conversation markdown: messages, tools, frontmatter, streaming, compaction |
| ConversationEventHandler | `ConversationEventHandler.ts` | Vault/event wiring: auto-init chat on note modify, title generation, intent dispatch    |
| WikilinkForwardService   | `WikilinkForwardService/`     | `forwarded_to` / `continued_to` chains and embed rewrites                               |
| UserMessageService       | `UserMessageService.ts`       | Parses user messages: strip images, attach metadata, build AI parts                     |
| CommandTrackingService   | `CommandTrackingService.ts`   | Tracks command execution state per conversation                                         |
| TrashCleanupService      | `TrashCleanupService.ts`      | Scheduled cleanup of soft-deleted files per retention policy                            |

### Vault / File / Content

| Service                   | Path                           | Role                                                                 |
| ------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| VaultService              | `VaultService/VaultService.ts` | Path existence resolution (visible vs hidden/dot paths)              |
| NoteContentService        | `NoteContentService.ts`        | Note split/merge, frontmatter, images, edit diffs, wikilink handling |
| ContentReadingService     | `ContentReadingService.ts`     | Implements read-content tool: cursor/element/range/frontmatter reads |
| MarkdownDefinitionService | `MarkdownDefinitionService/`   | Shared YAML-fence walker/replacer for vault markdown definitions     |

### Commands / Intent Processing

| Service                   | Path                         | Role                                                                              |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| CommandProcessorService   | `CommandProcessorService.ts` | Thin wrapper around `AgentRunner` + intent content validation                     |
| CommandInputService       | `CommandInputService.ts`     | Editor command-line input, CLI decorations, chat view integration                 |
| UserDefinedCommandService | `UserDefinedCommandService/` | Loads vault UDC YAML, triggers, step conditions, dispatches custom slash commands |

### Skills / Agents / Memory

| Service                   | Path                                    | Role                                                                       |
| ------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| SkillService              | `SkillService/`                         | Watches `Steward/Skills`, exposes skill catalog/bodies to the agent        |
| SubAgentDefinitionService | `SubAgent/SubAgentDefinitionService.ts` | Parses `Sub Agents.md` YAML agent blocks into spawn catalog                |
| SubagentSpawnService      | `SubAgent/SubagentSpawnService.ts`      | Runs background child conversations for delegated sub-agent tasks          |
| ToolInstructionService    | `Memory/ToolInstructionService.ts`      | Per-tool guidelines from `Memory/Tool instructions.md` merged into prompts |

### MCP

| Service    | Path                       | Role                                                                       |
| ---------- | -------------------------- | -------------------------------------------------------------------------- |
| MCPService | `MCPService/MCPService.ts` | Vault MCP note definitions, connections, tool prefixing (`mcp__`), secrets |

### Guardrails / Security

| Service               | Path                                            | Role                                                       |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| GuardrailsRuleService | `GuardrailsRuleService/`                        | Path/action rules from `Steward/Rules`                     |
| guardrailsMiddleware  | `GuardrailsRuleService/guardrailsMiddleware.ts` | Tool handler middleware enforcing guardrails               |
| EncryptionService     | `EncryptionService.ts`                          | Vault-specific encrypt/decrypt via Obsidian secret storage |

### CLI / PTY / Shell

| Service                       | Path                                             | Role                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CliSessionService             | `CliSessionService/`                             | Interactive/transcript CLI sessions via PTY or remote companion                                                                                                                                                                                     |
| ShellOutputArchiveService     | `CliSessionService/ShellOutputArchiveService.ts` | Archives completed shell output to `{title}__shell.md`; provides `headingRef:` resolution. Stubs above `MAX_INLINE_ARCHIVED_OUTPUT_LINES` (1500) render a wikilink to the archive section; at/below the threshold they use an inline toggle anchor. |
| PtyCompanionService           | `PtyCompanionService/`                           | Localhost PTY companion server for desktop shell sessions                                                                                                                                                                                           |
| NodePtyInstallerScriptService | `NodePtyInstallerScriptService/`                 | Syncs node-pty installer scripts into the vault                                                                                                                                                                                                     |

### Widgets

| Service                                                                        | Path                                       | Role                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------- |
| WidgetService                                                                  | `WidgetService/WidgetService.ts`           | Facade for multi-file widget projects: bundle, mount, hot-reload, action bridge |
| WidgetOrchestrator                                                             | `WidgetService/WidgetOrchestrator.ts`      | Turn scheduling: human saves vs model actors for interactive widgets            |
| WidgetSessionService                                                           | `WidgetService/WidgetSessionService.ts`    | Widget session conversations, Playground embed, model turn dispatch             |
| WidgetDefinitionService                                                        | `WidgetService/WidgetDefinitionService.ts` | Loads widget project definitions from vault                                     |
| WidgetStateService                                                             | `WidgetService/WidgetStateService.ts`      | Persists widget runtime state (`state.json`)                                    |
| WidgetBundler / WidgetBuild / WidgetAsset / WidgetJsValidator / WidgetProtocol | `WidgetService/`                           | Build, validate, and bundle widget HTML/JS/CSS                                  |

### Infrastructure

| Service               | Path                       | Role                                                       |
| --------------------- | -------------------------- | ---------------------------------------------------------- |
| EventEmitter          | `EventEmitter.ts`          | In-process typed pub/sub between services and agents       |
| AbortService          | `AbortService.ts`          | Per-conversation, per-operation `AbortController` registry |
| VersionCheckerService | `VersionCheckerService.ts` | Checks for plugin updates                                  |

## Common Patterns

### Singleton via `getInstance(plugin)`

Dominant pattern. Pass `StewardPlugin` on first call; later calls can omit plugin (throws if never initialized).

Most services re-create when `getInstance(plugin)` is called again with a plugin reference.

### Plugin-owned lazy loading

Services are exposed as getters on `StewardPlugin` in `src/main.ts` that create on first access:

```typescript
get widgetService(): WidgetService {
  if (!this._widgetService) {
    this._widgetService = WidgetService.getInstance(this);
  }
  return this._widgetService;
}
```

Eager init in `onLayoutReady`: `LLMService`, `AbortService`, `CompactionTokenService`, `ConversationEventHandler`, `TrashCleanupService`, plus touching lazy getters for Skill/Guardrails/MCP/ToolInstruction/SubAgent.

### Non-singleton services

Plain `new` when lifecycle is simpler:

- `CliSessionService`, `PtyCompanionService`, `WikilinkForwardService`, `SubagentSpawnService`, `CommandProcessorService`, `CompactionTokenService`, `ConversationEventHandler`, `TrashCleanupService`

### Vault-backed definitions

Repeated folder convention under `settings.stewardFolder`:

| Folder          | Service                   |
| --------------- | ------------------------- |
| `Skills/`       | SkillService              |
| `Commands/`     | UserDefinedCommandService |
| `Rules/`        | GuardrailsRuleService     |
| `MCP/`          | MCPService                |
| `Memory/`       | ToolInstructionService    |
| `Sub Agents.md` | SubAgentDefinitionService |
| `Widgets/`      | WidgetService             |

### Markdown YAML fence parsing

`MarkdownDefinitionService` walks Obsidian section cache for ` ```yaml ` blocks. Used by Skills, MCP, Widget definitions, Sub Agents, Tool instructions, UDC.

### Vault event watchers

Definition loaders register `vault.on('create'|'modify'|'delete')` inside `initialize()`. Register from `onLayoutReady`, not plugin `onload`.

### Event bus

`eventEmitter` from `EventEmitter.getInstance()`; typed payloads in `src/types/events.ts`.

## Adding a New Service

1. **Pick location** — single file at `src/services/MyService.ts`, or subfolder `src/services/MyService/` with optional `index.ts`
2. **Lifecycle** — prefer `static getInstance(plugin?: StewardPlugin)` + private constructor holding `StewardPlugin`
3. **Register** — add lazy getter on `StewardPlugin` in `src/main.ts` (`_myService` + `get myService()`)
4. **Initialize** — if vault watchers or folder scans: call `initialize()` from getter or `onLayoutReady`, not raw `onload`
5. **Dependencies** — take `StewardPlugin` in constructor; use `this.plugin.<otherService>` for peers
6. **User strings** — i18n via `getBundledInternal('i18n')` + `src/i18n/locales`
7. **Validation** — Zod schemas; vault paths via `normalizePath` and `plugin.settings.stewardFolder`
8. **Tests** — co-located `MyService.test.ts`
9. **When not singleton** — ephemeral/one-shot or stateless orchestration → plain class + `new`

## See Also

- [Root AGENTS.md](../../AGENTS.md)
- [src/solutions/commands/AGENTS.md](../solutions/commands/AGENTS.md) — agent handlers that consume these services
