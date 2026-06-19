---
name: interactive-widget
description: >-
  Expose model-callable widget actions and configure turn-based play via
  Widget.md (actions, actors, agent blocks). Read after stateful-widget when
  humans and models take turns.
version: 20
tools:
  - show_widget
---

# Interactive Widget Skill

Use this skill **after** the **stateful-widget** skill when a widget should accept **model turns** by adding **agents**, **actions**, and **actors**.

## When to use

- User wants **turn-ordered** interaction with one or more **model** actors.
- The widget already persists state (`getState` / `setState`) — see **stateful-widget** first.
- You need **host-dispatchable actions** (`registerAction`) documented in `Widget.md`.

Skip for static widgets, user-only interactivity with no model turns, or SVG `code` mode.

## Prerequisite workflow

1. Read **stateful-widget** → `show_widget` + working project with `setState`.
2. Then use this skill → interactive `window.stw` APIs in `main.js` + `actions` / `actors` / `agent` YAML fences in `Widget.md` (below the manifest block).

---

## `window.stw` APIs (interactive)

Read **stateful-widget** for host-injected persistence and asset APIs: `getState`, `setState`, `getAsset`, and `assets`. `window.stw` is injected by the host — do not author it in vault files.

This skill adds **turn-based** APIs:

| API                                        | Description                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `window.stw.getSession()`                  | Read-only. Returns a session object or `null` when no interactive session is active. Fields: `actor` (current turn id), `turnIndex`, `phase`, optional `moveLog`, optional `conversationTitle`. `phase` is `awaiting_input` (human or idle), `thinking` (model turn running), or `ended`. Use in `render()` for turn status (e.g. "O is thinking…"). Never write session — the host advances it. |
| `window.stw.setState(data, options?)`      | Saves **data** (debounced ~400ms). Optional **`options.intent: 'reset'`** clears host **`session`** for new game / play again / restart. **Does not trigger a model turn.** Options are host-only — never stored in `data`.                                                                                                                                                                      |
| `window.stw.registerAction(name, fn)`      | Register a handler the **host** dispatches during **model** turns. `name` must match a key under `actions` in `Widget.md`. Not called on human clicks.                                                                                                                                                                                                                                           |
| `window.stw.registerStatePresentation(fn)` | Register **`formatStateForModel(state)`** — returns a **string** text view of current `data` for model turns. Optional but recommended for grid/board games.                                                                                                                                                                                                                                     |
| `window.stw.dispatchAction(name, params)`  | Runs a registered handler inside the iframe (host `applyAction` bridge). Human clicks should call the shared action function directly instead.                                                                                                                                                                                                                                                   |

**Resetting game data vs session** — do not mix these up:

| Goal                          | How                                                              | Triggers model?                    | Clears `session`? |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------- | ----------------- |
| **Reset game ("Play again")** | Fresh initial `data` + **`setState(data, { intent: 'reset' })`** | **No**                             | **Yes**           |
| **Normal move**               | **`setState(data)`** only (no options)                           | **Yes** when next actor is `model` | **No**            |
| **Reset session only**        | **Edit `{projectPath}/state.json`** — remove the `session` key   | **No**                             | **Yes**           |

- **Play again / New game** → **`setState(freshData, { intent: 'reset' })`** — do not use `registerAction` for reset.
- Normal gameplay moves → **`setState(data)`** with no options.
- Widget code only writes **`data`** via `setState`. Session is host-owned in `state.json`.

**Action handler contract** (shared move function and `registerAction` callback):

| Return                 | Meaning                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `{ ok: false, error }` | Invalid move; host surfaces `error` to the model caller.          |
| `{ ok: true }`         | Success; call **`setState`** inside the handler before returning. |

Rules:

- `fn` receives `params` validated against the action's `params` spec in `Widget.md`.
- **Human clicks call the shared action function inside the iframe** — not the host, not `registerAction`.
- **`registerAction` is for model turns only** — after the LLM calls `widget_action`, the host dispatches via `applyAction` → `dispatchAction`.
- Every successful move must call **`setState`** (see **Human move → model turn**).
- Keep game state in `data` only; session fields come from `getSession()`.

### Human move → model turn

The host does **not** see action names like `playCell` when a human plays. It only sees **`setState`** with updated `data`.

| Step | What happens                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | User clicks in the iframe → click handler calls the shared action (e.g. `playCell(index)`) **locally**.                                                      |
| 2    | The action validates, updates game state, and calls **`window.stw.setState(data)`**.                                                                         |
| 3    | The iframe posts `widget-state-save` to the host (debounced ~400ms).                                                                                         |
| 4    | If no `session` yet, the host treats this as the first human move; if the next actor is `kind: model`, it **creates `session`** and runs that actor's agent. |
| 5    | If `session` exists, the host checks the current actor, advances the roster when appropriate, then runs the model agent when it's a model turn.              |
| 6    | The model agent calls `widget_action` → host **`applyAction`** → iframe **`dispatchAction`** → same registered handler → **`setState`** again.               |

You never call the host to "start the model turn". **`setState` after a valid human move is the trigger.**

### Session lifecycle (host-managed)

| Host action                                     | Who triggers it                  | Writes `session` to `state.json`      | Starts session conversation | Triggers model / LLM                                                            |
| ----------------------------------------------- | -------------------------------- | ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| **Mount**                                       | Host when widget renders         | **No**                                | **No**                      | **No** (unless `models_only` or first actor is `model`, then on first LLM call) |
| **Edit `state.json`** (remove `session`)        | You / model via `edit`           | Removes `session`                     | **No** until next LLM call  | **No**                                                                          |
| **Reset game (`setState` + `intent: 'reset'`)** | Widget "Play again" / "New game" | Removes `session` (any current actor) | No                          | **No**                                                                          |
| **Human move (`setState`)**                     | Widget after user click          | **Yes** — on first model turn         | **Yes** — when LLM runs     | **Yes** — when next actor is `model`                                            |
| **Model turn**                                  | Orchestrator                     | **Yes** — created/updated             | **Yes**                     | **Yes**                                                                         |

When a turn-based widget **mounts**, the host does **not** write `session` to `state.json`. `window.stw.getSession()` returns `null` until the first model turn.

**First model turn** (in `user_and_models` mode): after the human actor's **first gameplay** **`setState`**, the orchestrator creates `session`, opens the session conversation, updates Playground, and runs the model agent. Exception: `models_only`, or first actor is `kind: model`, may auto-run on mount (session still created at LLM call time).

**Playground** (`{stewardFolder}/Playground.md`) embeds the live session conversation **after** the first model turn. Before that, the note may be empty. There is no Playground link on the widget — point the user to Playground in your **final response** (see **Workflow**).

### `state.json` with interactive widgets

**stateful-widget** documents the base envelope (`version`, `updatedAt`, `data`). Interactive widgets may also have a host-owned **`session`** sibling:

```json
{
  "version": 1,
  "updatedAt": "2026-06-17T00:00:00.000Z",
  "data": { "board": [null, null, null, null, null, null, null, null, null], "current": "X" },
  "session": {
    "conversationTitle": "tic-tac-toe__session_abc",
    "actor": "user",
    "turnIndex": 0,
    "phase": "awaiting_input",
    "moveLog": []
  }
}
```

- **`data`** — your game state; update only via **`setState`** in the iframe (same as **stateful-widget**).
- **`session`** — turn roster, phase, conversation link; **host-owned**. Appears in `state.json` only after the orchestrator runs a model turn. **Do not** write from `main.js`. To **reset the session**, `edit` `{projectPath}/state.json` and **remove `session`**. The next model turn creates a fresh session and conversation.

Do not hand-author `session`; prefer deleting it and letting the host recreate it on the next model turn.

### How the host runs a model turn

When `actors.<id>.kind: model` and it's that actor's turn, the host runs a widget-focused agent (`agent.instruction` + public `data` snapshot + allowed actions). That agent calls `widget_action`, which the host dispatches into your **`registerAction`** handler — the **same function** a human click calls locally. Watch turns in **Playground** (`[[Steward/Playground.md]]` when `{stewardFolder}` is `Steward`).

### State presentation for model turns

Each model turn **user message** includes **JSON state** and a **text view** when your widget registers one (both default on).

1. Implement **`formatStateForModel(state)`** — takes current `data`, returns a non-empty **string** (ASCII grid, labeled rows, bullet summary, etc.).
2. Prefer a dedicated file such as **`statePresentation.js`**, loaded from `index.html` before `main.js`.
3. Register once at startup: **`window.stw.registerStatePresentation(formatStateForModel)`**.
4. The host calls your function when building the turn prompt and includes JSON + text under **Current game state**.
5. On **`widget_action`**, the model may set **`with_json: false`** or **`with_presentation: false`** to omit that section on the **next** turn (defaults: both true; at least one must stay enabled).
6. If the text view is missing, broken, or hard to read, the model should set **`with_presentation: false`** on the next action.

Example (`statePresentation.js`):

```javascript
function formatStateForModel(state) {
  if (!state || !Array.isArray(state.board)) {
    return 'Board unavailable';
  }

  var rows = [];
  for (var row = 0; row < 3; row += 1) {
    var cells = [];
    for (var col = 0; col < 3; col += 1) {
      var value = state.board[row * 3 + col];
      cells.push(value ? String(value) : '.');
    }
    rows.push(cells.join(' | '));
  }

  var lines = rows.join('\n');
  if (state.current) {
    lines += '\nCurrent: ' + state.current;
  }
  return lines;
}
```

```javascript
// main.js (after statePresentation.js is loaded)
window.stw.registerStatePresentation(formatStateForModel);
```

The host does **not** guess layouts — only your registered function runs.

---

## `Widget.md` (interactive blocks)

Project path, manifest fence, editable area, and editing workflow are defined in **stateful-widget**.

Note-level frontmatter `status` and `enabled` on `Widget.md` are **host-maintained** validation markers (do not hand-author unless missing). Add interactive YAML fences **below** the manifest block. After save, re-read `status` and fix errors before expecting model turns.

---

## YAML schema

Every fenced block you add via `edit` **must** include `name` as the block type identifier.

### `name: actions`

Catalog of actions the host may dispatch. Keys must match `registerAction` names in `main.js`.

| Field     | Type         | Required | Description                                         |
| --------- | ------------ | -------- | --------------------------------------------------- |
| `name`    | `actions`    | **Yes**  | Block type literal.                                 |
| `actions` | object (map) | **Yes**  | Map of action name → action definition (see below). |

**Action definition** (`actions.<actionName>`):

| Field         | Type         | Required | Description                                                    |
| ------------- | ------------ | -------- | -------------------------------------------------------------- |
| `description` | string       | No       | Human-readable summary for docs and prompts.                   |
| `params`      | object (map) | No       | Param name → param spec. Omit when the action takes no params. |

**Param spec** (`actions.<actionName>.params.<paramName>`):

| Field     | Type   | Required | Description                                                                                 |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| `type`    | string | No       | One of: `integer`, `number`, `string`, `boolean`. Default treated as `string` when omitted. |
| `minimum` | number | No       | Minimum value (`integer` / `number` only).                                                  |
| `maximum` | number | No       | Maximum value (`integer` / `number` only).                                                  |

Only **one** `actions` block is allowed. Required when any `agent` block exists.

### `name: actors`

Turn roster and policy. Required when any `agent` block exists.

| Field       | Type             | Required | Description                                                                                                                  |
| ----------- | ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `name`      | `actors`         | **Yes**  | Block type literal.                                                                                                          |
| `mode`      | string           | **Yes**  | `user_and_models` — wait for human actors between model turns. `models_only` — chain model turns (host burst limit applies). |
| `turnOrder` | array of strings | **Yes**  | Ordered actor ids; length defines participant count (2–N). Each id must exist in `actors`.                                   |
| `actors`    | object (map)     | **Yes**  | Actor id → actor entry (see below).                                                                                          |

**Actor entry** (`actors.<actorId>`):

| Field  | Type   | Required | Description                                                                                               |
| ------ | ------ | -------- | --------------------------------------------------------------------------------------------------------- |
| `kind` | string | **Yes**  | `human` — user input in the iframe. `model` — requires a matching `name: agent` block with the same `id`. |

Only **one** `actors` block is allowed. At least one `kind: model` actor is required when `agent` blocks exist.

### `name: agent`

One fence **per model actor**. Repeat the block for each `kind: model` entry in `actors`.

| Field         | Type             | Required | Description                                                                                                                                                                                                                                                                                               |
| ------------- | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | `agent`          | **Yes**  | Block type literal.                                                                                                                                                                                                                                                                                       |
| `id`          | string           | **Yes**  | Must match an `actors` key with `kind: model`.                                                                                                                                                                                                                                                            |
| `instruction` | string           | **Yes**  | This actor's persona/strategy. The host runs the turn as a **widget-focused agent** (not the Obsidian assistant) whose system prompt is host framing ("take one turn, call `widget_action`") **plus this instruction**. Write it as that actor's playing strategy/role. Plain text, no heading wikilinks. |
| `actions`     | array of strings | **Yes**  | Subset of action names from the `actions` catalog this actor may call.                                                                                                                                                                                                                                    |
| `model`       | string           | No       | LLM model id override for this actor; omit for plugin default chat model.                                                                                                                                                                                                                                 |

Each `agent.id` must be unique across `agent` blocks.

---

## Cross-validation (host-enforced)

On save, the host checks (including the host-maintained `manifest` block):

- At most one block each of `actions`, `actors`.
- When any `agent` block exists: `actions` and `actors` blocks required.
- Every `agent.id` has `actors.<id>` with `kind: model`.
- Every `turnOrder` id exists in `actors`.
- Every model actor in `actors` has an `agent` block.
- Every `agent.actions[]` name exists in `actions` catalog.
- No duplicate `agent.id`.

Fix `status` errors before expecting model turns to run.

---

## Examples

### Minimal `actions` block (no params)

```yaml
name: actions
actions:
  advanceTurn:
    description: Advance to the next phase
```

### Tic-tac-toe

```yaml
name: actions
actions:
  playCell:
    description: Place mark for current player
    params:
      index:
        type: integer
        minimum: 0
        maximum: 8
```

```yaml
name: actors
mode: user_and_models
turnOrder:
  - user
  - o
actors:
  user:
    kind: human
  o:
    kind: model
```

```yaml
name: agent
id: o
instruction: |
  You play O in tic-tac-toe. Pick one empty cell via playCell.
actions:
  - playCell
```

Matching `main.js` pattern:

```javascript
function playCell(index) {
  var state = window.stw.getState();
  // validate index, apply move for current player...
  window.stw.setState(state); // required — host detects human move from this
  return { ok: true };
  // or: return { ok: false, error: 'cell_taken' };
}

// Model path: host dispatches after widget_action
window.stw.registerAction('playCell', function (params) {
  return playCell(params.index);
});

function render(state) {
  var board = document.getElementById('board');
  board.innerHTML = '';
  for (var i = 0; i < 9; i++) {
    var cell = document.createElement('button');
    cell.textContent = state.board[i] || '';
    cell.addEventListener('click', function () {
      var result = playCell(i);
      if (!result.ok) {
        return;
      }
      render(window.stw.getState());
    });
    board.appendChild(cell);
  }
}

document.getElementById('play-again').addEventListener('click', function () {
  var state = { board: Array(9).fill(null), current: 'X' };
  window.stw.setState(state, { intent: 'reset' });
  render(state);
});

render(window.stw.getState());
```

Human clicks → local `playCell` → **`setState`** → host advances turn → model agent runs.
Model turns → host **`applyAction('playCell')`** → registered handler → **`setState`**.

---

## Workflow

1. **stateful-widget** → working widget with `setState`.
2. Interactive APIs + shared action functions + **`registerAction`** + click handlers in `main.js`.
3. Add **`statePresentation.js`** (or inline) + **`registerStatePresentation(formatStateForModel)`** when JSON alone is hard to read.
4. `edit` `Widget.md`: add `name: actions` (see **stateful-widget** for manifest and editing).
5. For model play: add `name: actors` + `name: agent` fence(s); confirm `status` valid.
6. Open note → widget mounts → **no `session` yet**; human **`setState`** triggers first model turn and session creation.
7. Human plays → **`setState`** → host runs the next model actor (creating/updating `session`).
8. "Play again" → **`setState(freshData, { intent: 'reset' })`** — host clears `session`; no model turn.
9. **Final response to the user** — after setup is complete (`status` valid, interactive blocks saved), end your message with a short note that Playground shows model turns live. Include an Obsidian wikilink to `{stewardFolder}/Playground.md`, e.g. `[[Steward/Playground.md]]` when the steward folder is `Steward`. Mention that the embed appears after the first model turn.

---

## Notes

- **Play again / New game** → **`setState(freshData, { intent: 'reset' })`** — clears `session`; no `startNewSession()` needed.
- **Playground link** — no widget footer link; tell the user in your final response with `[[Steward/Playground.md]]` (adjust path if `{stewardFolder}` is not `Steward`).
- **State presentation** — implement `formatStateForModel` + `registerStatePresentation`; host includes JSON + text in each turn prompt. Model opts out per view via `with_json` / `with_presentation` on `widget_action` for the **next** turn.
- Manifest placement, editable area, and `Widget.md` editing: **stateful-widget**.
- Add `agent` / `actors` only after `actions` works in `main.js` via `registerAction`.
- Human move does not trigger the model unless the action calls **`setState`** with changed `data` (forward gameplay, not a board clear).
- Expecting the host to call `playCell` on human click — only **`setState`** crosses to the host for human moves; `registerAction` is for model dispatch.
- `agent.actions` lists a name missing from `actions` or not registered in `main.js`.
- `turnOrder` id not defined in `actors`, or `agent.id` mismatch.
- `kind: human` actor given an `agent` block.
- Registering UI-only actions (reset) instead of local handlers + **`setState`**.
- Storing turn/session info in `data` — use `getSession()`; keep `data` game-only.
- **`edit` `Widget.md`** to add **`actions`**, **`actors`**, and **`agent`** is a MUST to complete interactive widget.
