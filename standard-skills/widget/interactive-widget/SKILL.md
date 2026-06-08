---
name: interactive-widget
description: >-
  Expose model-callable widget actions and configure turn-based play via
  Widget.md (actions, actors, agent blocks). Read after stateful-widget when
  humans and models take turns.
version: 7
tools:
  - show_widget
---

# Interactive Widget Skill

Use this skill **after** the **stateful-widget** skill when a widget should accept **model turns** (play vs AI, multi-model games, turn-ordered interaction).

## When to use

- User wants **turn-ordered** interaction with one or more **model** actors.
- The widget already persists state (`getState` / `setState`) — see **stateful-widget** first.
- You need **host-dispatchable actions** (`registerAction`) documented in `Widget.md`.

Skip for static widgets, user-only interactivity with no model turns, or SVG `code` mode.

## Prerequisite workflow

1. Read **stateful-widget** → `show_widget` + working project with `setState`.
2. Then use this skill → `registerAction` in `main.js` (keep it last when split) + YAML fences in `Widget.md`.

---

## Exposed actions (`main.js`)

Extract shared logic into action functions. User clicks and host dispatch call the **same** function. Register **only** actions models may invoke — not UI-only handlers (reset, local toggles).

| API                                   | Description                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `window.stw.registerAction(name, fn)` | Expose an action the host can dispatch into the iframe. `name` must match a key under `actions` in `Widget.md`. |
| Handler return `{ ok: false, error }` | Invalid move; host surfaces `error` to the caller.                                                              |
| Handler return `{ ok: true, state? }` | Success; persist game state with `setState` inside the handler.                                                 |

Rules:

- `fn` receives `params` validated against the action's `params` spec in `Widget.md`.
- User event handlers should call the same function the host will dispatch.
- **Do not** `registerAction` for reset/restart — use a local button or `window.stw.startNewSession()` for "Play again".

---

## File format

Path: `{projectPath}/Widget.md` (one per widget project under `{stewardFolder}/Widgets/{widgetId}/`).

- Markdown note with **note-level frontmatter** (`status`, `enabled`) plus **```yaml** fenced blocks in the body.
- Each fence is one definition block; discriminated by the root `name` field.
- A host-maintained `manifest` YAML fence at the top of the body (see **stateful-widget** for schema and placement). This skill covers only `actions`, `actors`, and `agent` blocks you add **below** it.

After creating or updating `Widget.md`, re-read the file and check frontmatter `status`. If invalid, fix YAML per the error and re-read.

---

## Note frontmatter

Host-maintained on save (do not hand-author unless missing).

| Field     | Type    | Required | Description                                                                      |
| --------- | ------- | -------- | -------------------------------------------------------------------------------- |
| `enabled` | boolean | No       | Default `true` when omitted; host sets on first validation.                      |
| `status`  | string  | No       | Validation result: valid marker or `Invalid: …` with semicolon-separated errors. |

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

| Field         | Type             | Required | Description                                                                       |
| ------------- | ---------------- | -------- | --------------------------------------------------------------------------------- |
| `name`        | `agent`          | **Yes**  | Block type literal.                                                               |
| `id`          | string           | **Yes**  | Must match an `actors` key with `kind: model`.                                    |
| `instruction` | string           | **Yes**  | Plain-text system prompt for this actor's turn (no heading wikilinks in Phase 2). |
| `actions`     | array of strings | **Yes**  | Subset of action names from the `actions` catalog this actor may call.            |
| `model`       | string           | No       | LLM model id override for this actor; omit for plugin default chat model.         |

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

## How to modify `Widget.md`

1. `content_reading` on `{projectPath}/Widget.md` — fences + frontmatter `status`.
2. `edit` — append or update `actions`, `actors`, and `agent` fences **below** the manifest block (see **stateful-widget**).
3. Re-read `status` after save (host validates on vault modify; `edit` tool result may include validation when stale).

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
  // validate, update state, setState, return { ok } or { ok: false, error }
}

window.stw.registerAction('playCell', function (params) {
  return playCell(params.index);
});
```

---

## Workflow

1. **stateful-widget** → working widget with `setState`.
2. `registerAction` + shared handlers in `main.js`.
3. `edit` `Widget.md`: add `name: actions`.
4. For model play: add `name: actors` + `name: agent` fence(s); confirm `status` valid.
5. Open note → widget mounts → host starts session when agents are configured.

---

## Notes

- The **editable area** of `Widget.md` is everything **below** the host-maintained `manifest` fence — add `actions`, `actors`, and `agent` blocks there only (see **stateful-widget** for manifest rules).
- Add `agent` / `actors` only after `actions` works in `main.js` via `registerAction`.
- `agent.actions` lists a name missing from `actions` or not registered in `main.js`.
- `turnOrder` id not defined in `actors`, or `agent.id` mismatch.
- `kind: human` actor given an `agent` block.
- Registering UI-only actions (reset) instead of local handlers.
- Replacing entire state in `setState` and dropping host-owned `session` fields (merge instead).
