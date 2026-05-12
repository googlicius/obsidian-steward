---
status: ✅ Valid
enabled: true
---
These commands are **Windows-specific**: they spawn fixed shell executables (`cmd.exe`, `bash.exe`, `powershell.exe`) as configured below. `bash.exe` is usually Git Bash or another install on your `PATH`; adjust `cli.shell` if your `bash` lives elsewhere.

Run the command with no input to **open an interactive terminal** for that shell;

Copy this note into your `Steward/Commands` folder (or equivalent) to use.

#### Command Prompt (cmd.exe)

```yaml
command_name: cmd
description: Windows Command Prompt (cmd.exe).
query_required: false
steps:
  - name: shell
    cli:
      shell: cmd.exe
    query: "{{from_user}}"
```

#### Bash (bash.exe)

```yaml
command_name: bash
description: Bash shell (e.g. Git Bash).
query_required: false
steps:
  - name: shell
    cli:
      shell: bash.exe
    query: "{{from_user}}"
```

#### PowerShell (powershell.exe)

```yaml
command_name: powershell
description: Windows PowerShell.
query_required: false
steps:
  - name: shell
    cli:
      shell: powershell.exe
    query: "{{from_user}}"
```
