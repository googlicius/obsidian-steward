---
name: guardrails
description: Define safety rules to restrict AI from reading, listing, creating, editing, or deleting specific folders or files. Use when the user wants to set up guardrails, access rules, or protect sensitive areas.
---

# Guardrails Skill

This skill enables you to define safety rules that restrict which folders and files the AI can access. Rules are stored as separate markdown files in `Steward/Rules/` — one file per rule.

## Rule File Structure

Each rule lives in its own `.md` file under `Steward/Rules/` (flat structure). Each file has:

1. **YAML frontmatter** — the rule definition (name, targets, actions, optional instruction, optional enabled)
2. **Documentation** — markdown body explaining the rule
3. **Verification query** — a ready-to-run command that triggers the rule so users can confirm it works (see below)

Create new rule files (Use create tool) when adding rules. Edit existing rule files (Use edit tool) when updating.

## Documentation

Keep the rule body brief plus the verification query.

## Verification Query

Include a **verification query** in each rule's documentation. This is a Steward command that would trigger the rule (and get blocked), so users can quickly confirm the rule works. Format:


- **Format:** Commands start with `/ ` (slash + space); put the command on its own line
- **Content:** A natural-language request that would perform one of the restricted actions on a target (e.g., list, read, create, edit)
  Add it in the rule body, e.g. under a **Verify** or **Test** section.

## Frontmatter Format

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | A short identifier for the rule (e.g., "No secrets access") |
| `targets` | Yes | Array of path patterns (folders or files). Use `folder/` for folders, `*.ext` for file types |
| `actions` | Yes | Array of actions to restrict: `read`, `list`, `create`, `edit`, `delete`, `grep`, `move`, `rename`, `copy`, `update_frontmatter` |
| `instruction` | No | Optional override only when the user explicitly requires strict guidance. Default is no instruction; violations are serialized for the AI to adapt |
| `enabled` | No | Set to `false` to disable a rule. Default is `true` |

## Example Rule File

Create `Steward/Rules/No secrets.md`:

```md
---
name: No secrets access
targets: ["Secrets/", "*.key", "Credentials/"]
actions: [read, list, create, edit, delete, grep]
instruction: "Never read, list, create, or modify files in Secrets/ or *.key"
enabled: true
---

Blocks access to sensitive files (API keys, credentials, Secrets folder).

**Verify:**

/ List files in the Secrets folder
```

Create `Steward/Rules/No private edits.md`:

```md
---
name: No private edits
targets: ["Private/"]
actions: [edit, delete]
enabled: true
---

Blocks editing and deleting in the Private folder. Violations are serialized for the AI to adapt.

**Verify:**

/ Edit a note in the Private folder
```

## Target Syntax

- **Folder paths:** `Secrets/` or `Private/` — matches the folder and all contents. Use trailing `/` for clarity.
- **File patterns:** `*.key` — matches files by extension. Use `*` prefix for glob-like matching.

## Instruction vs No Instruction (Default: No Instruction)

- **Without `instruction` (default):** On violation, the error is serialized as a tool result. The AI sees the block message and can try a different approach.
- **With `instruction` (explicit only):** Use this only when the user explicitly requires strict behavior. The instruction is added to tool guidelines, and violations stop processing immediately.
