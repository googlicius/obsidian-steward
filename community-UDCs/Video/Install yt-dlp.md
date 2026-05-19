---
status: ✅ Valid
enabled: true
version: 3
update_instructions:
  3: "Delete old files if they exist: 'yt-dlp.md', 'Installation instruction.md'."
---

#### Installs or upgrades [yt-dlp](https://github.com/yt-dlp/yt-dlp).

```yaml
command_name: install-yt-dlp
description: Install or upgrade yt-dlp using linked steps.
query_required: false
system_prompt:
  - "[[#Instruction]]"
steps:
  - query: "Help me install yt-dlp following **Installation instruction**."
tools: [content_reading, shell]
```

## Instruction

1. Prefer the **native installer** for the current OS when it is reliable and non-interactive.
2. **Verify** installation with `yt-dlp --version`.
3. If installation succeeds but commands fail later, mention **ffmpeg** (often required for merge/post-process).

## 0. Already installed?

```bash
command -v yt-dlp >/dev/null 2>&1 && yt-dlp --version
```

If `yt-dlp --version` prints a version, stop unless the user asked to upgrade.

## 1. Detect platform

Run **one** of these (Git Bash / WSL / macOS / Linux typically expose `uname`):

```bash
uname -s
```

| `uname -s` (typical) | Treat as |
|----------------------|----------|
| `Linux` | Linux (includes **WSL**) |
| `Darwin` | macOS |
| `MINGW64_NT-*`, `MSYS_NT-*`, `CYGWIN_NT-*` | Windows (Git Bash / MSYS / Cygwin) |

If the shell is **PowerShell** on Windows, use the Windows branch below (`winget`, etc.) without relying on `uname`.

## 2. Install by platform (MUST use interactive mode)

### Windows (native — preferred)

Use **winget** when available (exact package id):

```bash
winget install -e --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements
```

If `winget` is missing or fails, try **Scoop** or **Chocolatey** when the user already uses them:

```bash
scoop install yt-dlp
```

```bash
choco install yt-dlp -y
```

**Git Bash note:** If `winget` is not on `PATH` in Bash, run via PowerShell or `cmd`:

```bash
powershell.exe -Command "winget install -e --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements"
```

### macOS

```bash
brew install yt-dlp
```

If Homebrew is unavailable, use **pipx** (see cross-platform).

### Linux (incl. WSL)

Prefer the distro **package manager** when appropriate, for example:

- Debian/Ubuntu: `sudo apt update && sudo apt install -y yt-dlp`
- Fedora: `sudo dnf install -y yt-dlp`
- Arch: `sudo pacman -S yt-dlp`

If the packaged version is too old or missing, use **pipx** (see cross-platform).

### Cross-platform fallback (Python ecosystem)

When package managers are awkward or the user already uses Python tooling:

```bash
pipx install yt-dlp
```

Ensure pipx’s bin dir is on `PATH` (pipx prints a hint when needed). On Linux/macOS this is often `~/.local/bin`.

## 3. Verify

```bash
yt-dlp --version
```

If the command is not found after install, open a **new terminal** (PATH refresh) or log out/in on Windows.

## 4. ffmpeg (when downloads fail after install)

Many workflows need **ffmpeg** for merging streams or post-processing. If errors mention ffmpeg or merging:

- **Windows:** `winget install -e --id Gyan.FFmpeg` (or another trusted ffmpeg package the user prefers)
- **macOS:** `brew install ffmpeg`
- **Linux:** install `ffmpeg` with the same distro package manager used above

## Anti-patterns

- Do not assume **only** `pip install yt-dlp` globally unless the user wants system Python touched; prefer **pipx** or OS packages.
- On Windows, do not assume `uname` is available in **cmd.exe** — use `winget` / PowerShell detection instead.
