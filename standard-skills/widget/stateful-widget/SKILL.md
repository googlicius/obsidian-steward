---
name: stateful-widget
description: >-
  Build interactive HTML project widgets with persisted runtime state (games,
  counters, forms). Read before show_widget when user actions must survive
  reopening the note.
version: 9
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

- **Mount (`WidgetPostProcessor`)**: When the note is displayed, the post-processor reads the fence, resolves `{stewardFolder}/Widgets/{widgetId}`, bundles the entry HTML (inlines linked CSS/JS from the project folder), injects `window.stw` for state and assets, and renders the bundle in a **sandboxed iframe** (`srcdoc`, `allow-scripts`, strict CSP, no network). Manifest `assets` are **not** inlined into HTML; the iframe requests allowed files from the host at runtime and creates local blob URLs.

- **Hot-reload**: Edits to project files via `edit` trigger a re-bundle and iframe refresh.

Only **project (HTML multi-file) widgets** get the state bridge and `state.json`. Single-blob `code` widgets do not persist runtime state this way.

## How state is managed

| Piece                       | Role                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `window.stw`                | API injected into the iframe by the host (not written by you in vault files).                                           |
| `window.stw.getState()`     | Returns last saved **data** object, or `null` on first load.                                                            |
| `window.stw.setState(data)` | Saves a **JSON-serializable** snapshot; debounced ~400ms, then written to vault.                                        |
| `state.json`                | Created **lazily** in the project folder on first successful `setState`. Host-owned; do not author or edit it manually. |

Note: You **must** call `setState` after every meaningful state change. Without it, `state.json` never appears.

### On-disk shape (host-managed)

```json
{
  "version": 1,
  "updatedAt": "2026-05-29T00:00:00.000Z",
  "data": {}
}
```

Your widget only supplies the inner `data` object via `setState`. Define a schema that fully describes the UI (e.g. board cells, score, turn).

### Manifest assets and `window.stw.getAsset`

Only vault paths listed in the manifest `assets` array may be loaded. The host injects an **allowlist registry** on `window.stw.assets` (vault paths, not loadable URLs). Keys:

| Key                                                | Example manifest path | Use in state                                                |
| -------------------------------------------------- | --------------------- | ----------------------------------------------------------- |
| **Stem** (filename without extension, when unique) | `Images/x.png`        | `"x"`                                                       |
| **Vault path** (normalized)                        | `Images/x.png`        | `"Images/x.png"` — always safe; required when stems collide |

`window.stw.getAsset(id)` is **async** (`Promise<string | null>`). The iframe asks the host for file bytes, then creates a **local** blob URL inside the iframe. Results are cached per id for the session.

Add a new image by editing **only** `Widget.md` manifest `assets` (then save). Hot-reload rebuilds the registry — no `main.js` map update if you already look up by stem.

**Static markup:** `asset:…` in HTML attributes (`src`, `href`, `poster`) and CSS `url(asset:…)` is auto-hydrated on load. You can still author:

```html
<img src="asset:Images/board.png" alt="Board" /> <audio src="asset:Audio/track.mp3"></audio>
```

**Dynamic UI:** store a short id in state (stem or vault path) and resolve at render time:

```javascript
let state = window.stw.getState() ?? { cells: Array(9).fill(null), turn: 'x' };

async function render() {
  await Promise.all(
    state.cells.map(async (cell, i) => {
      const img = document.querySelector(`[data-cell="${i}"]`);
      img.src = cell ? await window.stw.getAsset(cell) : '';
    })
  );
}
```

Declare every vault path in manifest `assets`. Use unique filenames when relying on stem keys; if two assets share a stem, use the full vault path in state and in `getAsset`.

### Do not persist asset paths or blob URLs in state

`state.json` is not processed for assets at load time.

- **Do not** put `asset:…` paths, vault paths, or blob URLs in `setState` data.
- **Do** store a short id (filename stem when unique, otherwise full vault path) and resolve via `await window.stw.getAsset(id)`.

## Required JavaScript pattern (`main.js`)

Put hydrate + save in `main.js` (or inline script in `index.html` if you do not split files). Scripts run **after** `window.stw` is injected in the document head. If `render` uses assets, make it `async` and `await getAsset`.

```javascript
// 1. Hydrate on load
let state = window.stw.getState() ?? {
  cells: Array(9).fill(null),
  turn: 'x',
};

async function render() {
  // draw UI from state (await stw.getAsset when setting media src)
}

function commitState() {
  window.stw.setState(state);
}

// 2. On each user action that changes app state
async function onCellClick(index) {
  if (state.cells[index]) return;
  state.cells[index] = state.turn;
  state.turn = state.turn === 'x' ? 'o' : 'x';
  await render();
  commitState();
}

void render();
```

Rules:

- `getState()` once at startup (or merge with defaults).
- `setState(state)` after every change users should see after reopening.
- Keep `data` small and JSON-safe (no functions, DOM nodes, or circular refs).
- Never store `asset:` paths, vault paths, or blob URLs in state — persist stem ids (or full vault paths) and use `await stw.getAsset` (see above).
- Use one object as source of truth; re-render from it.

## `Widget.md` — `name: manifest` block (host-maintained)

`show_widget` creates `{projectPath}/Widget.md` with a single `yaml` fence at the **top** of the note body. The host writes it on create — **do not** remove or replace the block. You may **edit** it later to add or update `assets` and `maxAssetSize` (e.g. for large audio). Any other fences (`actions`, `actors`, `agent`) go **below** the manifest fence (see **interactive-widget**).

| Field          | Type             | Required | Description                                                                                                                                                                                                                                                                             |
| -------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | `manifest`       | **Yes**  | Block type literal.                                                                                                                                                                                                                                                                     |
| `entry`        | string           | **Yes**  | Relative path to the HTML entry file (e.g. `index.html`).                                                                                                                                                                                                                               |
| `type`         | `html`           | **Yes**  | Must be `html` for project widgets.                                                                                                                                                                                                                                                     |
| `widgetId`     | string           | No       | Project folder id; host sets on create.                                                                                                                                                                                                                                                 |
| `widgetName`   | string           | No       | Display name from `show_widget`.                                                                                                                                                                                                                                                        |
| `assets`       | array of strings | No       | **Allowlist** of vault paths the iframe may request. Exposed on `window.stw.assets`; resolve with `await getAsset(stem)` or `await getAsset("Path/to/file")`. Reference in static HTML/CSS/JS as `asset:Path/to/file`. Only listed paths are served.                                    |
| `maxAssetSize` | string or number | No       | Per-file byte cap when the host reads an asset. Plain numbers are bytes (e.g. `5000000`). Suffixes supported: `B`, `KB`, `MB`, `GB` (spacing optional, e.g. `5MB`, `5 mb`, `5 MB`). Host sets `5MB` on create; default when omitted from manifest: `5MB`. Raise this for larger assets. |

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

Large assets: if an asset exceeds `maxAssetSize`, the host refuses the request (`asset_too_large`, logged in the developer console). If a path is missing from the vault, you will see `asset_not_found`. Use `edit` on `Widget.md` to add paths to `assets` or increase `maxAssetSize` when media fails to load.

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
- Saving `asset:Path/...`, vault paths, or blob URLs in `setState` — use stem ids (or full vault paths) with `await stw.getAsset` instead.
- Requesting an asset not listed in manifest `assets` → `getAsset` resolves to `null` (`asset_not_allowed` on the host).

## Workflow

1. Call `show_widget` with `type: "html"`, `widgetName` (natural language), and `files` (project mode).
2. Implement `main.js` with `getState` / `setState` as above.
3. Later changes: `content_reading` + `edit` on `projectPath`; preserve the state API when refactoring.
