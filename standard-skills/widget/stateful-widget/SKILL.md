---
name: stateful-widget
description: >-
  Build interactive HTML project widgets with persisted runtime state (games,
  counters, forms). Read before show_widget when user actions must survive
  reopening the note.
version: 8
tools:
  - show_widget
---
# Stateful Widget Skill

Use this skill when creating **interactive HTML project widgets** (games, counters, quizzes, forms) where user actions must persist after the user closes and reopens the conversation note.

## When to use

- User asks for a **game**, **interactive demo**, **counter**, **quiz**, or any widget that changes based on clicks/keyboard input.
- You use `show_widget` with **project mode** (`files: [{ name, content }, ...]`), not a single `code` blob.
- State must survive: reopening the note, scrolling away and back, or editing widget **code** files (hot-reload).

Skip this pattern for static animations, one-shot diagrams, or SVG-only widgets with no runtime state.

## How a widget is rendered

- **Create (`show_widget`)**: Writes project files under `{stewardFolder}/Widgets/{widgetId}/` (`index.html`, `main.js`, `style.css`, `Widget.md`, etc.). `widgetId` = slugified `widgetName` + short unique suffix. Appends a `stw-widget-project` fence to the conversation note:
  ```stw-widget-project
  <widgetId>
  ```

- **Mount (`WidgetPostProcessor`)**: When the note is displayed, the post-processor reads the fence, resolves `{stewardFolder}/Widgets/{widgetId}`, bundles the entry HTML (inlines linked CSS/JS; vault files from manifest `assets` and `asset:` references in HTML/CSS/JS, subject to `maxAssetSize`), injects `window.stw` for state, and renders the bundle in a **sandboxed iframe** (`srcdoc`, `allow-scripts`, strict CSP, no network).

- **Hot-reload**: Edits to project files via `edit` trigger a re-bundle and iframe refresh.

Only **project (HTML multi-file) widgets** get the state bridge and `state.json`. Single-blob `code` widgets do not persist runtime state this way.

## How state is managed

| Piece | Role |
|-------|------|
| `window.stw` | API injected into the iframe by the host (not written by you in vault files). |
| `window.stw.getState()` | Returns last saved **data** object, or `null` on first load. |
| `window.stw.setState(data)` | Saves a **JSON-serializable** snapshot; debounced ~400ms, then written to vault. |
| `state.json` | Created **lazily** in the project folder on first successful `setState`. Host-owned; do not author or edit it manually. |

Note: You **must** call `setState` after every meaningful state change. Without it, `state.json` never appears.

### On-disk shape (host-managed)

```json
{
  "version": 1,
  "updatedAt": "2026-05-29T00:00:00.000Z",
  "data": { }
}
```

Your widget only supplies the inner `data` object via `setState`. Define a schema that fully describes the UI (e.g. board cells, score, turn).

### Manifest assets and `window.stw.assets`

The host injects every manifest `assets` entry as inlined data URLs on `window.stw.assets` (and `window.stw.getAsset(id)`). Keys:

| Key | Example manifest path | Use in state |
|-----|----------------------|--------------|
| **Stem** (filename without extension) | `Images/x.png` | `"x"` |
| **Vault path** (normalized) | `Images/x.png` | `"Images/x.png"` when stems collide |

Add a new image by editing **only** `Widget.md` manifest `assets` (then save). Hot-reload rebuilds the registry — no `main.js` map update if you already look up by stem.

Static `asset:…` literals in HTML/CSS/JS still work for fixed markup; use `stw.assets` / `getAsset` for dynamic UI driven by persisted state.

### Do not persist `asset:` paths in state

`asset:…` references in project files are resolved at **bundle time**. `state.json` is not re-processed for assets.

- **Do not** put vault paths (`asset:Images/foo.png`) or data URLs in `setState` data.
- **Do** store a short id in state (filename stem, e.g. `"x"`) and resolve at render time via `window.stw.getAsset(id)` or `window.stw.assets[id]`.

```javascript
let state = window.stw.getState() ?? { cells: Array(9).fill(null), turn: 'x' };

function render() {
  state.cells.forEach((cell, i) => {
    const img = document.querySelector(`[data-cell="${i}"]`);
    img.src = cell ? window.stw.getAsset(cell) : '';
  });
}
```

Declare every vault path in manifest `assets`. Use unique filenames when relying on stem keys.

## Required JavaScript pattern (`main.js`)

Put hydrate + save in `main.js` (or inline script in `index.html` if you do not split files). Scripts run **after** `window.stw` is injected in the document head.

```javascript
// 1. Hydrate on load
let state = window.stw.getState() ?? {
  cells: Array(9).fill(null),
  turn: 'x',
};

function render() {
  // draw UI from state
}

function commitState() {
  window.stw.setState(state);
}

// 2. On each user action that changes app state
function onCellClick(index) {
  if (state.cells[index]) return;
  state.cells[index] = state.turn;
  state.turn = state.turn === 'x' ? 'o' : 'x';
  render();
  commitState();
}

render();
```

Rules:

- `getState()` once at startup (or merge with defaults).
- `setState(state)` after every change users should see after reopening.
- Keep `data` small and JSON-safe (no functions, DOM nodes, or circular refs).
- Never store `asset:` paths or data URLs in state — persist stem ids and use `stw.getAsset` (see above).
- Use one object as source of truth; re-render from it.

## `Widget.md` — `name: manifest` block (host-maintained)

`show_widget` creates `{projectPath}/Widget.md` with a single ```yaml``` fence at the **top** of the note body. The host writes it on create — **do not** remove or replace the block. You may **edit** it later to add or update `assets` and `maxAssetSize` (e.g. for large audio). Any other fences (`actions`, `actors`, `agent`) go **below** the manifest fence (see **interactive-widget**).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `manifest` | **Yes** | Block type literal. |
| `entry` | string | **Yes** | Relative path to the HTML entry file (e.g. `index.html`). |
| `type` | `html` | **Yes** | Must be `html` for project widgets. |
| `widgetId` | string | No | Project folder id; host sets on create. |
| `widgetName` | string | No | Display name from `show_widget`. |
| `assets` | array of strings | No | Vault paths inlined at bundle time. Exposed as `window.stw.assets` / `getAsset(stem)` (stem = filename without extension). Also reference as `asset:Path/to/file` in static HTML/CSS/JS. |
| `maxAssetSize` | string or number | No | Per-file size cap for inlining declared assets. Plain numbers are bytes (e.g. `5000000`). Suffixes supported: `B`, `KB`, `MB`, `GB` (spacing optional, e.g. `5MB`, `5 mb`, `5 MB`). Host sets `5MB` on create; default when omitted from manifest: `5MB`. Raise this for larger assets. |

Example (host-written on create):

```yaml
name: manifest
entry: index.html
type: html
widgetId: My-Game-abc12
widgetName: My Game
maxAssetSize: 5MB
assets:
  - Images/sprite.png
```

Large assets: if an asset exceeds `maxAssetSize`, the host skips inlining it (logged in the developer console). Use `edit` on `Widget.md` to add or increase `maxAssetSize` when assets fail to load or the user needs larger files.

## Project layout checklist

- `index.html` — entry; `<link href="style.css">`, `<script src="main.js">`.
- `main.js` — logic + `window.stw` hydrate/save.
- `style.css` — optional styles.
- `Widget.md` — host-created; **manifest** fence at top (see above). Do not edit the manifest block.
- `state.json` — auto-created on first `setState`; do not include in `show_widget` `files`.

## Notes

- The **editable area** of `Widget.md` is everything **below** the host-maintained `manifest` fence — never insert or change content above or inside that fence.
- Game logic updates variables/DOM but never calls `window.stw.setState` → no persistence.
- Using `code` single-blob mode for a game → no `window.stw` / `state.json`.
- Putting state only in closure variables with no serializable snapshot.
- Saving `asset:Path/...` or data URLs in `setState` — use stem ids with `stw.getAsset` instead.

## Workflow

1. Call `show_widget` with `type: "html"`, `widgetName` (natural language), and `files` (project mode).
2. Implement `main.js` with `getState` / `setState` as above.
3. Later changes: `content_reading` + `edit` on `projectPath`; preserve the state API when refactoring.
