export interface BuiltInSkill {
  name: string;
  description: string;
  content: string;
  version: number;
  /** Path under Skills/ where SKILL.md is written. Defaults to `name`. */
  folder?: string;
}

export const BUILT_IN_SKILLS: BuiltInSkill[] = [
  {
    name: 'update-title',
    description: 'Update the conversation title stored in the note frontmatter',
    version: 1,
    content: `The conversation title is stored as the \`conversation_title\` frontmatter property in the current conversation note.

To update it, use the \`update_frontmatter\` tool:
- First, use \`list\` with \`folderPath: "$steward/Conversations"\` to find the current conversation note
- Then set \`files\` to the path of the current conversation note
- Set \`properties\` to \`[{ name: "conversation_title", value: "<your new title>" }]\``,
  },
  {
    name: 'stateful-widget',
    description:
      'Build interactive HTML project widgets with persisted runtime state (games, counters, forms). Read before show_widget when user actions must survive reopening the note.',
    version: 2,
    content: `# Stateful Widget Skill

Use this skill when creating **interactive HTML project widgets** (games, counters, quizzes, forms) where user actions must persist after the user closes and reopens the conversation note.

## When to use

- User asks for a **game**, **interactive demo**, **counter**, **quiz**, or any widget that changes based on clicks/keyboard input.
- You use \`show_widget\` with **project mode** (\`files: [{ name, content }, ...]\`), not a single \`code\` blob.
- State must survive: reopening the note, scrolling away and back, or editing widget **code** files (hot-reload).

Skip this pattern for static animations, one-shot diagrams, or SVG-only widgets with no runtime state.

## How a widget is rendered

1. **Creation**: \`show_widget\` writes files under \`{stewardFolder}/Widgets/{widgetId}/\` (e.g. \`index.html\`, \`main.js\`, \`style.css\`, \`Widget.md\`). \`widgetId\` is derived from \`widgetName\` (whitespace → dashes) plus a short unique suffix.
2. **Conversation**: A \`stw-widget-project\` fence in the note references \`widgetId\` and \`projectPath\`. Widgets are conversation-independent — reference \`widgetId\` from any conversation to edit or display the same widget.
3. **Mount**: The host bundles \`index.html\` (inlines linked CSS/JS and vault \`asset:\` paths), wraps the result in a **sandboxed iframe** (\`srcdoc\`, \`allow-scripts\`, strict CSP, no network).
4. **Hot-reload**: When you edit project files via \`edit\`, the iframe reloads from the vault. **Do not** call \`show_widget\` again for updates.

Only **project (HTML multi-file) widgets** get the state bridge and \`state.json\`. Single-blob \`code\` widgets do not persist runtime state this way.

## How state is managed

| Piece | Role |
|-------|------|
| \`window.stw\` | API injected into the iframe by the host (not written by you in vault files). |
| \`window.stw.getState()\` | Returns last saved **data** object, or \`null\` on first load. |
| \`window.stw.setState(data)\` | Saves a **JSON-serializable** snapshot; debounced ~400ms, then written to vault. |
| \`state.json\` | Created **lazily** in the project folder on first successful \`setState\`. Host-owned; do not author or edit it manually. |

**Critical:** Clicks and DOM updates alone do **not** persist. You **must** call \`setState\` after every meaningful state change. Without it, \`state.json\` never appears.

Saving \`state.json\` does **not** reload the iframe (the host ignores that file for hot-reload). Editing \`main.js\` / \`index.html\` **does** reload and re-injects saved state from \`state.json\`.

### On-disk shape (host-managed)

\`\`\`json
{
  "version": 1,
  "updatedAt": "2026-05-29T00:00:00.000Z",
  "data": { }
}
\`\`\`

Your widget only supplies the inner \`data\` object via \`setState\`. Define a schema that fully describes the UI (e.g. board cells, score, turn).

## Required JavaScript pattern (\`main.js\`)

Put hydrate + save in \`main.js\` (or inline script in \`index.html\` if you do not split files). Scripts run **after** \`window.stw\` is injected in the document head.

\`\`\`javascript
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
\`\`\`

Rules:

- \`getState()\` once at startup (or merge with defaults).
- \`setState(state)\` after every change users should see after reopening.
- Keep \`data\` small and JSON-safe (no functions, DOM nodes, or circular refs).
- Use one object as source of truth; re-render from it.

## Project layout checklist

- \`index.html\` — entry; \`<link href="style.css">\`, \`<script src="main.js">\`.
- \`main.js\` — logic + \`window.stw\` hydrate/save.
- \`style.css\` — optional styles.
- \`Widget.md\` — created by host; contains a \`name: manifest\` YAML block listing \`entry\` and optional \`assets\`.
- \`state.json\` — auto-created on first \`setState\`; do not include in \`show_widget\` \`files\`.

## Common mistakes

- Game logic updates variables/DOM but never calls \`window.stw.setState\` → no persistence.
- Using \`code\` single-blob mode for a game → no \`window.stw\` / \`state.json\`.
- Putting state only in closure variables with no serializable snapshot.
- Calling \`show_widget\` again to update — use \`edit\` on project files instead.

## Workflow

1. Call \`show_widget\` with \`type: "html"\`, \`widgetName\` (natural language), and \`files\` (project mode).
2. Implement \`main.js\` with \`getState\` / \`setState\` as above.
3. Later changes: \`content_reading\` + \`edit\` on \`projectPath\`; preserve the state API when refactoring.`,
  },
  {
    name: 'edit-table',
    folder: 'edit/table',
    description:
      'Edit markdown tables via the edit tool. Read before add_table_column, update_table_column, or delete_table_column — especially for large tables (20+ rows).',
    version: 1,
    content: `# Edit Table Skill

Use this skill when editing **markdown tables** with the \`edit\` tool. Prefer the table-specific modes over \`replace_by_lines\` — they are faster and use fewer tokens, especially for **large tables (more than 20 rows)**.

## When to use

- Add, update, or remove a **column** in an existing table.
- The table spans many rows and rewriting the whole table would be wasteful.
- You already know the table's line range (\`fromLine\`–\`toLine\`) in the note.

For small, non-tabular edits inside a table row, \`replace_by_lines\` may still be appropriate — but column operations should use the modes below.

## Shared parameters

All table modes require:

| Field | Description |
|-------|-------------|
| \`path\` | Path of the **existing** note containing the table. |
| \`fromLine\` | Starting line (0-based) of the table in the note. |
| \`toLine\` | Ending line (0-based) of the table in the note. |

Use \`content_reading\` first if you need to locate the table or confirm line numbers.

## Modes

### \`add_table_column\`

Add a new column to the table.

**Extra fields:**

| Field | Description |
|-------|-------------|
| \`content\` | New column in Markdown: header, separator (\`---\`), then one value per data row (newline-separated). Example: \`Status\\n---\\nPending\\nDone\` |
| \`insertAfter\` | Optional. Column header name to insert after. |
| \`insertBefore\` | Optional. Column header name to insert before. |
| *(placement)* | If both \`insertAfter\` and \`insertBefore\` are omitted, the column is added at the end. |

Return **only the new column** (header + separator + values), not the entire table.

### \`update_table_column\`

Update an existing column (header, values, or both).

**Extra fields:**

| Field | Description |
|-------|-------------|
| \`content\` | Edited column in the same format as \`add_table_column\`. |
| \`position\` | Optional. 0-based column index to update. Defaults to the **last** column. |

Return **only the updated column**, not the entire table.

### \`delete_table_column\`

Remove a column from the table.

**Extra fields:**

| Field | Description |
|-------|-------------|
| \`position\` | Optional. 0-based column index to delete. Defaults to the **last** column. |

No \`content\` field — the column is removed by position.

## Content rules

- Return **only the changed column** (for add/update), not surrounding rows or the full table.
- \`content\` must include the header row, a \`---\` separator line, and one line per table data row (pad with empty lines if a cell is blank).
- Match the number of value lines to the table's row count (header + separator + data rows).

## Workflow

1. Read the note (or relevant section) to get the table and line range.
2. Choose the table mode and set \`fromLine\` / \`toLine\` to bound the table.
3. Pass one or more table operations in a **single** \`edit\` call (do not split across multiple tool calls).

## Common mistakes

- Using \`replace_by_lines\` to rewrite an entire large table instead of column modes.
- Sending the full table in \`content\` instead of just the target column.
- Wrong \`fromLine\` / \`toLine\` (table includes header, separator, and all data rows).`,
  },
];
