---
status: ✅ Valid
enabled: true
---
Run [Gemini CLI](https://github.com/google-gemini/gemini-cli) in **headless** mode (`--prompt`) from a Steward user-defined command. Copy this note into your `Steward/Commands` folder (or equivalent) to install.

#### Definition

```yaml
command_name: gemini
query_required: true
steps:
  - name: shell
    query: >-
      gemini --prompt "{{from_user}}"{{#cli_continuing}} --resume{{/cli_continuing}}
```
