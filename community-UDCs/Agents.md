---
status: ✅ Valid
enabled: true
version: 1
---
These commands run popular **terminal agent CLIs** from a Steward user-defined command (same pattern as [Shells](Shells.md): a `shell` step with an optional query).

Run the command **with no input** to start the agent in its normal **interactive** mode (where the CLI supports it). Add text after the command to pass a **one-shot** prompt on the first shell line.

Steward expands the templates below in chat when the conversation has a title (Mustache `{{from_user}}` and the `{{#from_user}}` / `{{^from_user}}` sections). Copy this note into your `Steward/Commands` folder (or equivalent) to install.

Install each CLI from its project docs and ensure the executable is on your `PATH`.

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

#### OpenClaw ([OpenClaw CLI](https://docs.openclaw.ai/cli/agent))

Uses a **`--local`** embedded run with the **`ops`** agent id as in the upstream examples—change `ops` in the YAML to match a configured agent in your OpenClaw setup. With no Steward query, `--message` is omitted; if your `openclaw` version insists on `-m`, add `--message "{{from_user}}"` with a harmless default or adjust both branches.

```yaml
command_name: openclaw
description: OpenClaw agent (--local; edit --agent name in YAML).
query_required: false
steps:
  - name: shell
    query: >-
      {{^from_user}}openclaw agent --local --agent ops{{/from_user}}{{#from_user}}openclaw agent --local --agent ops --message "{{from_user}}"{{/from_user}}
```
