# src/views/ — Custom Obsidian Views

Custom `MarkdownView` subclasses for Steward's chat shell and reading shell, plus view-builders that generate supporting vault notes.

Registration: `src/main.ts` → `registerStuffs()`.

## Layout

```
src/views/
├── StewardMarkdownView.ts       # Abstract base: shared header, dock toggle
├── ChatView.ts                  # Main chat pane (Steward/Chat.md)
├── ReadingView.ts               # Preview-only reading pane (History, .art, etc.)
├── ChatView.test.ts
├── ReadingView.test.ts
└── view-builders/
    ├── ViewBuilder.ts           # Interface + refreshViewBuilder()
    ├── HistoryViewBuilder.ts    # Builds Steward/History.md
    ├── HistoryViewBuilder.test.ts
    └── CommandsViewBuilder.ts   # Builds Steward/Commands.md from community manifest
```

## View Types

From `src/constants.ts`:

| Constant                   | Type string              | Class         |
| -------------------------- | ------------------------ | ------------- |
| `CHAT_VIEW_CONFIG.type`    | `'steward-conversation'` | `ChatView`    |
| `READING_VIEW_CONFIG.type` | `'steward-reading'`      | `ReadingView` |

`.art` files are registered to open in `ReadingView` via `registerExtensions(['art'], READING_VIEW_CONFIG.type)`.

## Files

| File                                   | Role                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `StewardMarkdownView.ts`               | Base class: custom header (new chat, history, dock toggle), disables navigation, `canAcceptExtension` → false        |
| `ChatView.ts`                          | Chat note editor; auto-scroll during streaming; `startNewChat()`, `openExistingConversation()`, version notify embed |
| `ReadingView.ts`                       | Forces preview mode; hides Obsidian properties panel via MutationObserver                                            |
| `view-builders/ViewBuilder.ts`         | `buildContent()` + `write()` contract; `refreshViewBuilder()` helper                                                 |
| `view-builders/HistoryViewBuilder.ts`  | Scans `Conversations/`, writes clickable `stw-history-link` list to `History.md`                                     |
| `view-builders/CommandsViewBuilder.ts` | Renders community UDC install/update table into `Commands.md` from `COMMUNITY_UDC_MANIFEST`                          |

## Patterns

### Inheritance

`ChatView` / `ReadingView` extend `StewardMarkdownView` extend Obsidian `MarkdownView`.

### CSS hooks

`stw-view`, `stw-chat`, `stw-reading` on container.

### Header actions

Replace default `.view-header` with steward toolbar:

- **New chat** — `plugin.startNewChat(leaf)`
- **History** — `refreshViewBuilder(new HistoryViewBuilder(plugin))` + open reading view
- **Dock toggle** — `plugin.toggleViewDockFromView(leaf)`; persists `settings.chatViewDock` for ChatView

### ViewBuilder pattern

```typescript
interface ViewBuilder {
  buildContent(): Promise<string>;
  write(): Promise<void>;
}

// Helper
await refreshViewBuilder(new HistoryViewBuilder(plugin));
```

Used from header history button and `RunPostProcessor` embed links (`a.stw-embed`).

### Leaf resolution

- `plugin.getStewardLeaf()` — prefer existing chat or reading leaf, else create in configured dock
- `plugin.resolveStewardLeaf()` — prefer active steward view, else `getStewardLeaf()`
- `plugin.openChat()` / `plugin.openReadingView()` — set view state with `{ file, mode? }`

## ChatView vs ReadingView

| Aspect           | ChatView                        | ReadingView                        |
| ---------------- | ------------------------------- | ---------------------------------- |
| File             | `Steward/Chat.md`               | Any markdown (History, .art, etc.) |
| Mode             | Editor (command input)          | Preview only                       |
| Conversations    | Embeds `![[Conversations/...]]` | Displays generated lists           |
| Dock persistence | Yes (`chatViewDock` setting)    | Follows leaf                       |

## Registration in main.ts

```typescript
this.registerView(CHAT_VIEW_CONFIG.type, leaf => new ChatView(leaf, this));
this.registerView(READING_VIEW_CONFIG.type, leaf => new ReadingView(leaf, this));
this.registerExtensions(['art'], READING_VIEW_CONFIG.type);
```

## Entry Points

| Action                     | Trigger                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| Open chat                  | Ribbon icon, `toggle-chat` command, squeezed block click                    |
| Open reading view          | History header button, `HistoryPostProcessor`, `RunPostProcessor` embed     |
| Open existing conversation | `HistoryPostProcessor`, `ChatView.openExistingConversation()`               |
| Toggle dock                | Header button → `toggleViewDockFromView` → refocus command input after move |

## Streaming UX

`ChatView` listens to vault `modify` + `conversationRenderer.isStreaming()` for auto-scroll. Pairs with:

- `CollapsibleBlockPostProcessor` — auto-scroll thinking/cli blocks
- `CalloutEditPreviewPostProcessor` — auto-scroll streaming review callouts
- `ConversationFooterProcessor` — status + token usage footer on embeds

## Post-Processor Connections

- `HistoryPostProcessor` → opens `ChatView` via `openExistingConversation`
- `StewardConversationProcessor` → `plugin.closeConversation()` (squeeze/close)
- `RunPostProcessor` → `a.stw-embed` opens reading view with generated content

## See Also

- [Root AGENTS.md](../../AGENTS.md)
- [src/post-processors/AGENTS.md](../post-processors/AGENTS.md)
- [src/cm/extensions/AGENTS.md](../cm/extensions/AGENTS.md)
- [scripts/AGENTS.md](../../scripts/AGENTS.md) — `CommandsViewBuilder` consumes generated UDC manifest
