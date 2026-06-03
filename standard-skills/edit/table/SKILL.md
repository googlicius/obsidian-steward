---
name: edit-table
description: >-
  Edit markdown tables via the edit tool. Read before add_table_column,
  update_table_column, or delete_table_column — especially for large tables (20+
  rows).
version: 2
tools:
  - edit
---
# Edit Table Skill

Use this skill when editing **markdown tables** with the `edit` tool. Prefer the table-specific modes over `replace_by_lines` — they are faster and use fewer tokens, especially for **large tables (more than 20 rows)**.

## When to use

- Add, update, or remove a **column** in an existing table.
- The table spans many rows and rewriting the whole table would be wasteful.
- You already know the table's line range (`fromLine`–`toLine`) in the note.

For small, non-tabular edits inside a table row, `replace_by_lines` may still be appropriate — but column operations should use the modes below.

## Shared parameters

All table modes require:

| Field | Description |
|-------|-------------|
| `path` | Path of the **existing** note containing the table. |
| `fromLine` | Starting line (0-based) of the table in the note. |
| `toLine` | Ending line (0-based) of the table in the note. |

Use `content_reading` first if you need to locate the table or confirm line numbers.

## Modes

### `add_table_column`

Add a new column to the table.

**Extra fields:**

| Field | Description |
|-------|-------------|
| `content` | New column in Markdown: header, separator (`---`), then one value per data row (newline-separated). Example: `Status\n---\nPending\nDone` |
| `insertAfter` | Optional. Column header name to insert after. |
| `insertBefore` | Optional. Column header name to insert before. |
| *(placement)* | If both `insertAfter` and `insertBefore` are omitted, the column is added at the end. |

Return **only the new column** (header + separator + values), not the entire table.

### `update_table_column`

Update an existing column (header, values, or both).

**Extra fields:**

| Field | Description |
|-------|-------------|
| `content` | Edited column in the same format as `add_table_column`. |
| `position` | Optional. 0-based column index to update. Defaults to the **last** column. |

Return **only the updated column**, not the entire table.

### `delete_table_column`

Remove a column from the table.

**Extra fields:**

| Field | Description |
|-------|-------------|
| `position` | Optional. 0-based column index to delete. Defaults to the **last** column. |

No `content` field — the column is removed by position.

## Content rules

- Return **only the changed column** (for add/update), not surrounding rows or the full table.
- `content` must include the header row, a `---` separator line, and one line per table data row (pad with empty lines if a cell is blank).
- Match the number of value lines to the table's row count (header + separator + data rows).

## Workflow

1. Read the note (or relevant section) to get the table and line range.
2. Choose the table mode and set `fromLine` / `toLine` to bound the table.
3. Pass one or more table operations in a **single** `edit` call (do not split across multiple tool calls).

## Common mistakes

- Using `replace_by_lines` to rewrite an entire large table instead of column modes.
- Sending the full table in `content` instead of just the target column.
- Wrong `fromLine` / `toLine` (table includes header, separator, and all data rows).
