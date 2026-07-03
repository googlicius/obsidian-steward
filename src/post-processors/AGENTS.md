# src/post-processors/ — Markdown Post-Processors

Obsidian markdown post-processors transform Steward-authored markdown into interactive DOM: callouts, buttons, embed chrome, CLI terminals, widgets, etc. They run on **every** markdown preview (chat, reading view, embedded conversations, normal notes).

Registration site: `src/main.ts` → `registerStuffs()`.

## Patterns

- **Factory naming:** `createXxxPostProcessor(plugin?: StewardPlugin): MarkdownPostProcessor`
- **Plugin injection:** Interactive processors take `StewardPlugin`; passive ones take no plugin
- **DOM targeting:** Query `.callout[data-callout="stw-*"]`, fenced `pre > code.language-*`, text markers (`{{stw-*}}`), or authored HTML (`a.stw-run`, `a.stw-embed`)
- **Idempotent binding:** `dataset.*Bound === '1'`, `dataset.bound`, or `hasAttribute(INDICATOR_ATTR)` to avoid double listeners
- **Deferred DOM work:** `window.setTimeout(...)` when sibling structure or live document is required

## Registration Order

**`CalloutMetadataProcessor` must run first** so later processors can read `data-line`, `data-streaming`, etc.

```typescript
// src/main.ts registerStuffs() — order matters
createCalloutMetadataProcessor()           // 1. metadata first
createCalloutActionPostProcessor(this)
createCalloutSearchResultPostProcessor(this)
createCalloutEditPreviewPostProcessor()
createUserMessageButtonsProcessor(this)
createConversationIndicatorProcessor(this)
createStewardConversationProcessor(this)
createStwSourcePostProcessor(this)
createCollapsibleBlockPostProcessor(this)
createCliTranscriptPostProcessor()
createCliXtermPostProcessor(this)
createWidgetPostProcessor(this)
createConfirmationButtonsProcessor(this)
createHistoryPostProcessor(this)
createRunPostProcessor(this)
```

## Processors

| File | Plugin? | Role |
|------|---------|------|
| `CalloutMetadataProcessor.ts` | No | Parses `stw-*` callout title metadata (`key:value,...`) into `data-*` attributes |
| `CalloutActionPostProcessor.ts` | Yes | Binds click handlers on `stw-notify` / `stw-actions` callout buttons with `data-action` |
| `CalloutSearchResultPostProcessor.ts` | Yes | Makes `stw-search-result` callouts clickable to jump to file/line/range |
| `CalloutEditPreviewPostProcessor.ts` | No | Click-to-expand `stw-review` callouts; auto-scroll when `data-streaming="true"` |
| `UserMessageButtonsProcessor.ts` | Yes | Reload/delete icon buttons on `stw-user-message` callouts |
| `ConversationIndicatorProcessor.ts` | Yes | “Generating…” overlay on embedded conversations; listens to `CONVERSATION_INDICATOR_CHANGED` |
| `StewardConversationProcessor.ts` | Yes | Decorates conversation embeds: title sync, squeeze/close buttons, `stw-conversation` class |
| `StwSourcePostProcessor.ts` | Yes | Replaces `{{stw-source ...}}` with `@filename` chips in preview |
| `CollapsibleBlockPostProcessor.ts` | Yes | Auto-scroll + toggle for `stw-thinking` / `cli-model` fences; lazy-load archived shell output from `__shell.md` on click |
| `CliTranscriptPostProcessor.ts` | No | Strips stream markers; blinking cursor on active `cli-transcript` / `cli-model` blocks |
| `CliXtermPostProcessor.ts` | Yes | Mounts live xterm.js + PTY for `cli-xterm` fenced blocks |
| `WidgetPostProcessor.ts` | Yes | Mounts widget iframes from widget fence languages; bridges to `WidgetService` |
| `ConfirmationButtonsProcessor.ts` | Yes | Renders `{{stw-confirmation-buttons ...}}` as Yes/No → `user_confirm` intents |
| `HistoryPostProcessor.ts` | Yes | **Path-scoped:** only on `Steward/History.md` — wraps history links, open-in-chat + delete |
| `RunPostProcessor.ts` | Yes | Binds `a.stw-run` (UDC click commands) and `a.stw-embed` (history/commands view builders) |

## Upstream Authors

| Processor targets | Written by |
|-------------------|------------|
| `stw-*` callouts, confirmation markers, search results | `ConversationRenderer` |
| `cli-transcript`, `cli-xterm`, stream markers | `CliSessionService` |
| Widget fence blocks | `WidgetService` / ShowWidget handler |
| `History.md` / `Commands.md` content | `HistoryViewBuilder` / `CommandsViewBuilder` |
| `{{stw-source}}`, `{{stw-squeezed}}` | Editor CM extensions + conversation notes |

## Downstream Services (on click)

- `CommandProcessorService`, `UserDefinedCommandService`
- `ConversationRenderer`
- `CliSessionService`, `WidgetService`
- `plugin.closeConversation()`, `ChatView.openExistingConversation()`
- `MediaTools` (search navigation)

## Gotchas

- **`HistoryPostProcessor`** is the only path-scoped processor — checks note path before binding
- **Symmetry with CM extensions:** Editor shows widgets for `{{stw-source}}` / `{{stw-squeezed}}`; preview uses post-processors for the same syntax
- **Resume flow:** `UserMessageButtonsProcessor` and `ConfirmationButtonsProcessor` re-emit intents to continue paused agent turns

## See Also

- [Root AGENTS.md](../../AGENTS.md)
- [src/cm/extensions/AGENTS.md](../cm/extensions/AGENTS.md) — editor-side counterparts
- [src/views/AGENTS.md](../views/AGENTS.md) — views opened by processors
