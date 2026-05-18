---
status: ✅ Valid
enabled: true
version: 1
---
These commands run popular **terminal agent CLIs** from a Steward user-defined command.

#### Gemini ([Gemini CLI](https://github.com/google-gemini/gemini-cli))

```yaml
command_name: gemini
description: Gemini CLI (Google).
query_required: false
steps:
  - name: shell
    query: >-
      {{^from_user}}gemini{{/from_user}}{{#from_user}}gemini "{{from_user}}"{{/from_user}}
```

#### Claude ([Claude Code](https://docs.anthropic.com/en/docs/claude-code))

```yaml
command_name: claude
description: Claude Code CLI (Anthropic).
query_required: false
steps:
  - name: shell
    query: >-
      {{^from_user}}claude{{/from_user}}{{#from_user}}claude "{{from_user}}"{{/from_user}}
```

#### Hermes ([Hermes Agent](https://hermes-agent.nousresearch.com/))

```yaml
command_name: hermes
description: Hermes Agent CLI (Nous Research).
query_required: false
steps:
  - name: shell
    query: >-
      {{^from_user}}hermes{{/from_user}}{{#from_user}}hermes chat -q "{{from_user}}"{{/from_user}}
```
