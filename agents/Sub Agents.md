---
version: 2
---

Specialized sub-agents for `spawn_subagent`. Each agent is defined by a level-2 heading and a `name: agent` YAML fence directly below it.

## YAML block (`name: agent`)

| Field           | Required | Description                                                              |
| --------------- | -------- | ------------------------------------------------------------------------ |
| `name`          | Yes      | Must be `agent`                                                          |
| `id`            | Yes      | Unique agent id used when spawning                                       |
| `description`   | Yes      | Short summary shown in the agent catalog                                 |
| `instruction`   | Yes      | System prompt for the sub-agent worker                                   |
| `model`         | No       | LLM override in `provider:model` format (e.g. `google:gemini-2.5-flash`) |
| `enabled`       | No       | `false` skips this agent; default `true`                                 |
| `tools`         | No       | Default active tools for spawned jobs                                    |
| `inactiveTools` | No       | Default inactive tools the sub-agent may activate                        |

Only `agent` YAML fences are loaded. Other block types make the file invalid.

## Image vision

```yaml
name: agent
id: image_vision
description: Reads and analyzes images using a vision-capable model
model: google:gemini-2.5-flash
instruction: |
  You are an image analysis agent in Obsidian Steward.
  Your job is to read image files and answer questions about their visual content.
  Use content_reading to load image files. Describe what you see accurately.
  Stay focused on the delegated image task; keep responses concise.
tools:
  - content_reading
inactiveTools:
  - grep
  - search
```
