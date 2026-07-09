# src/cm/extensions/ — CodeMirror Extensions

CodeMirror 6 extensions for Steward command input in editors. Registered **globally** (not limited to ChatView) via `registerEditorExtension` in `src/main.ts`.

## Layout

```
src/cm/extensions/
├── CommandInputExtension.ts          # Main command-line UX (decorations, Enter, paste, keymap)
├── StwSourceBlockExtension.ts        # Inline {{stw-source}} / @path widgets
├── StwSqueezedBlockExtension.ts      # Inline {{stw-squeezed [[...]]}} chips
└── AutocompleteExtension/
    ├── AutocompleteExtension.ts      # Composes autocompletion override
    ├── commandCompletionSource.ts    # /command prefixes + UDC names
    ├── datasourceCompletionSource.ts # @file / @folder after command prefix
    ├── modelCompletionSource.ts      # m: / model: picker
    └── index.ts                      # Re-exports AutocompleteExtension
```

## Files

| File                                                  | Role                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CommandInputExtension.ts`                            | ViewPlugin decorations for command blocks, Enter→`main.handleEnter`, paste/PNG embed helpers, CLI caption badges |
| `StwSourceBlockExtension.ts`                          | StateField + `WidgetType` replaces `{{stw-source}}` and `@encoded/path` with clickable chips                     |
| `StwSqueezedBlockExtension.ts`                        | Widget chip for `{{stw-squeezed [[title]]}}`; click re-opens conversation in chat                                |
| `AutocompleteExtension/AutocompleteExtension.ts`      | Wires `autocompletion({ override: [...] })` with datasource → model → command priority                           |
| `AutocompleteExtension/commandCompletionSource.ts`    | Suggests built-in `/` prefixes and user-defined command names                                                    |
| `AutocompleteExtension/datasourceCompletionSource.ts` | `@` file/folder completion after valid command prefix; inserts short `@path` refs                                |
| `AutocompleteExtension/modelCompletionSource.ts`      | `m:` / `model:` completion; persists to settings or conversation frontmatter                                     |

## Patterns

- **Factory naming:** `createXxxExtension(plugin: StewardPlugin, options?)` returning `Extension` or extension array
- **Registration bundle** in `main.ts`:

```typescript
this.registerEditorExtension([
  createCommandInputExtension(this, { onEnter: this.handleEnter.bind(this), ... }),
  createStwSourceBlocksExtension(this),
  createStwSqueezedBlocksExtension(this),
  createAutocompleteExtension(this),
]);
```

- **Enter handling:** Extension delegates to `StewardPlugin.handleEnter` in `main.ts`, not inside the extension itself
- **Widget decorations:** `StateField` + `StateEffect.define()` + `WidgetType.toDOM()`; patterns from `src/constants.ts` (`STW_SOURCE_*`, `STW_SQUEEZED_PATTERN`)
- **CommandInputExtension sub-extensions:** `createInputExtension`, `createCommandKeymapExtension`, `createPasteHandlerExtension`, `createPngEmbedTrailingSpaceExtension`, `createArrowDownNewLineExtension`

## Enter / Command Flow

1. User presses Enter on a `/` command line (or continuation line)
2. `CommandInputExtension` → `StewardPlugin.handleEnter`
3. `CommandInputService.getCommandBlock` + `getCommandBlockContent`
4. Match prefix via `UserDefinedCommandService.buildExtendedPrefixes`
5. Create/update conversation note via `ConversationRenderer`
6. Emit `Events.CONVERSATION_INTENT_RECEIVED` or `CONVERSATION_LINK_INSERTED`

## Shared Brain: CommandInputService

`src/services/CommandInputService.ts` is used by both CM extensions and `main.ts`:

- Prefix detection, continuation lines (`TWO_SPACES_PREFIX`), command blocks
- `withEditor(editor)` for context menu “Add to chat/inline conversation”
- CLI session decoration refresh via `cliSessionDecorationRefresh` annotation

## Autocomplete Priority

Override array order in `AutocompleteExtension`:

1. `datasourceCompletionSource` — `@` paths after valid command prefix
2. `modelCompletionSource` — `m:` / `model:`
3. `commandCompletionSource` — `/` prefixes and UDC names

## Symmetry with Post-Processors

| Syntax                         | Editor (CM)                 | Preview (post-processor)           |
| ------------------------------ | --------------------------- | ---------------------------------- |
| `{{stw-source ...}}` / `@path` | `StwSourceBlockExtension`   | `StwSourcePostProcessor`           |
| `{{stw-squeezed [[title]]}}`   | `StwSqueezedBlockExtension` | (embed via conversation processor) |

## Services Used

- `UserDefinedCommandService` — prefixes, UDC names, CLI shell hints
- `CliSessionService` — CLI caption decorations
- `ConversationRenderer` — conversation link detection above command line
- `LLMService` — model completion labels

## See Also

- [Root AGENTS.md](../../AGENTS.md)
- [src/post-processors/AGENTS.md](../post-processors/AGENTS.md) — preview-side rendering
- [src/views/AGENTS.md](../views/AGENTS.md) — ChatView command input focus after dock toggle
