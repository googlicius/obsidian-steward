---
status: ✅ Valid
enabled: true
---
This command walks through a **Git** + **SOPS** clean/smudge setup (ciphertext in the repo, readable files in the vault) and scaffolds `Steward/Commands/Git commands.md` for one-line `shell` UDCs. Copy this file to `Steward/Commands`, then run `/git-sync-setup`.

**What will be installed or verified:**

- **Git** — must already be installed on the system; this setup does **not** install Git for you. You need it for clean/smudge, the repo, and push.
- **[SOPS](https://github.com/getsops/sops)** — encrypts on `clean` and decrypts on `smudge`, so Git never stores plaintext for the paths you list in `.gitattributes`.
- **age** — provides the key format used in `.sops.yaml` (`creation_rules`); SOPS uses it to encrypt file data with your public key (private key stays off the vault).

*Reader note: the paragraph above only for human. The agent follows **[[#Setup workflow]]***

#### Command definitions

```yaml
command_name: git-sync-setup
query_required: false
show_todo_list: true
tools:
  - shell
  - create
  - content_reading
  - todo_write
  - exists
  - edit
system_prompt:
  - "[[#Setup workflow]]"
steps:
  - query: "Help me execute the setup following your `Obsidian sync with Git + SOPS setup` instructions"
```

## Setup workflow

Obsidian sync with Git + SOPS setup

### Objective

Enable **encrypted-at-rest content in Git** (remote and object store) with a **plain local working tree**: configure **SOPS** with **age**, **Git clean/smudge**, **.gitattributes** and **.sops.yaml** (use **File templates**), then **optional** `Git commands.md` shell helpers. Outcome: the user can sync without putting readable secrets in Git for the chosen paths, and understands key handling and normal `git` workflows.

### Early stop

Halt or stop when one of the following applies.

- **Git not installed** — If `git --version` fails (Git missing or not on `PATH`), stop. Do not try to install Git via this setup. Give one copy-pastable install hint for their OS and tell them to return and type **continue** after Git works.

- **SOPS already configured** — If the repo root has **`.sops.yaml`** and/or **`.gitattributes`**, run `git config --get filter.sops.clean` and `git config --get filter.sops.smudge`. If both are non-empty, stop and state that the SOPS filter is already set up.

- **age missing** — If `age --version` fails, stop. Tell the user to start an **interactive** terminal (Do it in this chat is fine), run **one** copy-pastable install command for their OS, then type **continue** to resume. Check "age" exists before continuing.

### Rules

After the **Early stop** checks and confirming `git`, `sops` (install with user approval if missing), and `age`, continue by following these rules.

- **Progress:** Use `todo_write` to track **Phases** (1–7) and the **Skip `Git commands.md`** rule; keep statuses in sync as you finish or skip each phase.
- Shell: one full command per approval; use `git -C <root> …` if the git root is not the vault.
- **Skip `Git commands.md`:** With `exists`, if `$steward/Commands/Git commands.md` is present, **do not** create or overwrite it; skip that sub-step and mention the file is left as-is.
- Use the `shell` tool to read dot-prefixed files, the `read_content` tool can only read vault files that visible to users.

### File templates (default)

Use these at the **repository** root unless the user asks otherwise. For `.gitattributes`, use either the “all `*.md`” block or the per-folder lines—not both, unless the user wants both (comment the lines they do not use).

**`.gitattributes`**

```gitattributes
# Encrypt all markdown files
*.md filter=sops diff=sops

# Or only specific files/folders
# Encrypt files in Secret* folders
Secret*/** filter=sops diff=sops merge=sops
# Encrypt files with .secret. in the name
*.secret.* filter=sops diff=sops merge=sops
```

**`.sops.yaml`**

```yaml
creation_rules:
  - path_regex: \.md$
    age: PUBLIC_KEY

  - path_regex: '.*/Secret[^/]*/.*'
    age: PUBLIC_KEY
```

Replace `PUBLIC_KEY` with the user's real age public key. You fill that in during **Phase 3** (below), usually by running `age-keygen -y <path-to-private-key>` in an approved shell and pasting the printed line into `creation_rules`.

### Phases

If everything is good then create a todo list following these phases.

0. **Age key** — Ask the user (in plain text, no tool use) if they already have a key, otherwise generate one.

1. **Config** —

   ```ini
   [filter "sops"]
   clean  = sops --encrypt --input-type binary /dev/stdin
   smudge = sops --decrypt --input-type binary /dev/stdin
   required = true
   [diff "sops"]
   textconv = sops --decrypt
   ```

   Apply with `git config` as appropriate (`--local` vs `--global`). If `/dev/stdin` fails on Windows, use Git Bash or the current SOPS docs for stdin on that OS.

2. **`.gitattributes`** — create/edit in the repo root with **File templates** (vault tools if the root is the vault; otherwise guide the user). Ask the user (no tool call) which **files or directories** they want encrypted for working on this.

3. **`.sops.yaml`** — create at the repo root with **File templates**. For each `age:` field, substitute the real public key (not the literal `PUBLIC_KEY`): typically `age-keygen -y` on the user’s private key file via shell, then paste that one line into the YAML (never put the private key file or its contents in the vault).

4. **Optional** — `git add --renormalize .` only if they need it and understand the impact.

5. **`Git commands.md`** — unless **Skip** above: `create` at `$steward/Commands/Git commands.md` with three UDCs: 

````markdown
#### Example `Git commands.md` body

```yaml
command_name: git-status
query_required: false
steps:
  - name: ">"
    query: "git status"
```

```yaml
command_name: git-commit
query_required: true
steps:
  - name: ">"
    query: "git add -A && git commit -m $from_user"
```

```yaml
command_name: git-commit-push
query_required: true
steps:
  - name: ">"
    query: "git add -A && git commit -m $from_user && git push"
```
````
6. **Test the setup** — confirm the filter pipeline end-to-end:
   - Working tree: the file in the editor / vault should read as **normal format** after the smudge filter.
   - Object store: after `git add` (or on `HEAD` once committed), `git show :<path>` or `git show HEAD:<path>` for that file should look **SOPS-encrypted** (not plain text).
   - Optional: `git diff` on that path should be readable (textconv + decrypt).
   - If any check fails, fix config or files before **Close**.
   - Clean test files after finishing.

7. **Close** — short summary; if **Phase 5** ran, point to `/git-status`, `/git-commit`, `/git-commit-push`. Remind (Important): back up keys if newly generated, never commit private key material, verify on another clone if needed.
