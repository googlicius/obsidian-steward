# src/solutions/ — Feature Subsystems

Self-contained feature subsystems consumed by services and agent handlers. Each subfolder owns a distinct domain.

## Subfolders

| Subfolder | Role | Key files |
|-----------|------|-----------|
| [`commands/`](commands/AGENTS.md) | Core command/agent system: intents, agents, tools, handlers | See [commands/AGENTS.md](commands/AGENTS.md) |
| `artifact/` | Persist operation results as `stw-artifact` blocks for revert, pagination, batch processing | `ArtifactManagerV2.ts`, `types.ts`, `serializers/` |
| `search/` | In-repo BM25 search engine v3 | `searchService.ts`, `indexer.ts`, `documentStore.ts`, `searchEngineV3/`, `tokenizer/` |
| `pty-companion/` | Out-of-process Socket.IO PTY server for desktop shell | `server.ts`, `client.ts`, `protocol.ts`, `resolveVaultPtyNativePath.ts` |
| `widgets/` | Empty placeholder — widget runtime lives in `src/services/WidgetService/` | — |

## artifact/

Structured operation results are serialized into conversation notes as `stw-artifact` blocks.

- **ArtifactManagerV2** — singleton per conversation; caches artifacts; syncs on vault `modify`
- **types.ts** — `ArtifactType` enum (search, edit, widget, deleted files, etc.) + typed interfaces; `revertAbleArtifactTypes`
- **serializers/** — per-type serialize/deserialize: `SearchResultSerializer`, `ReadContentSerializer`, `WidgetSerializer`, `GeneratedContentSerializer`, `CompositeSerializer`, `JsonSerializer`

Consumed by handlers (Search, Edit, VaultDelete, etc.) and revert flows.

See [docs/technicals/Artifact architecture.md](../../docs/technicals/Artifact%20architecture.md).

## search/

BM25-based vault search with typo tolerance, significantly faster than native Obsidian search.

- **SearchService** — singleton wiring `DocumentStore`, `Indexer`, `Tokenizer`, `Scoring`, `QueryBuilder`/`QueryExecutor`
- **searchEngineV3/** — condition tree (`And`/`Or`/`Keyword`/`Property`/`Folder`/`Filename`), `SearchContext`, `DocumentPropertyFilter`
- **database/** — `SearchDatabase` (IndexedDB) lives in `src/database/`

Used by `handlers/Search.ts`, `handlers/BuildSearchIndex.ts`, and `ArtifactManagerV2`.

See [docs/technicals/Steward search system v2.md](../../docs/technicals/Steward%20search%20system%20v2.md).

## pty-companion/

Obsidian/Electron cannot spawn PTY directly. This out-of-process companion runs a loopback Socket.IO server that spawns real PTY processes.

- **createRemotePtySession** in `client.ts` — child-process-like API consumed by `CliSessionService`
- **CliHandler** (`commands/agents/handlers/CliHandler.ts`) — drives shell tool execution

Desktop only. Requires node-pty native bundle for interactive mode.

## widgets/

Directory exists but has no source files. Widget pipeline:

- `ShowWidget` / `WidgetActionHandler` handlers
- `WidgetService` / `WidgetOrchestrator` / `WidgetSessionService` in `src/services/WidgetService/`
- `WidgetPostProcessor` for preview rendering

## Cross-Folder Dependencies

```
commands/agents/handlers/
  ├── Search, BuildSearchIndex  →  search/SearchService
  ├── Edit, VaultDelete, ...    →  artifact/ArtifactManagerV2
  └── CliHandler                →  pty-companion/client.ts
```

Agent internals (SuperAgent, handlers, mixins) are documented in [commands/AGENTS.md](commands/AGENTS.md).

## See Also

- [Root AGENTS.md](../../AGENTS.md)
- [src/services/AGENTS.md](../services/AGENTS.md)
