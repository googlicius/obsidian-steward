---
status: ✅ Valid
enabled: true
---
Run [Gemini CLI](https://github.com/google-gemini/gemini-cli) from a Steward user-defined command. Copy this note into your `Steward/Commands` folder (or equivalent) to install.

#### Definition

```yaml
command_name: gemini
query_required: true
steps:
  - name: shell
    query: >-
      gemini "{{from_user}}"
```
