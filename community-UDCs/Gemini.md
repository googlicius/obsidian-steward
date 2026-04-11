---
status: ✅ Valid
enabled: true
---
Run [Gemini CLI](https://github.com/google-gemini/gemini-cli) in **headless** mode (`--prompt`) from a Steward user-defined command. Copy this note into your `Steward/Commands` folder (or equivalent) to install.

UDC steps support **`$...` placeholders** and **`{{...}}` Mustache** in the same `query`: `$` values are expanded first, then Mustache. The Mustache context includes `from_user`, `steward`, `active_file`, `file_name`, and `cli_continuing` (true only while a Steward CLI shell session is active for this conversation). Use `{{#cli_continuing}} --resume{{/cli_continuing}}` so the first run (no live session yet) omits `--resume`; the next message in the same session adds it.

#### Definition

```yaml
command_name: gemini
query_required: true
steps:
  - name: shell
    query: >-
      gemini --prompt {{from_user}}{{#cli_continuing}} --resume{{/cli_continuing}}
```
