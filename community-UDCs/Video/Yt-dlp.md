---
status: ✅ Valid
enabled: true
version: 2
---

#### Installs or upgrades [yt-dlp](https://github.com/yt-dlp/yt-dlp).

```yaml
command_name: install-yt-dlp
description: Install or upgrade yt-dlp using linked steps.
query_required: false
system_prompt:
  - "[[#Instruction]]"
steps:
  - query: "Help me install yt-dlp following [[Installation instruction]]."
tools: [content_reading, shell]
```

## Instruction

Read "$steward/Commands/Video/Installation instruction.md" for the installation instructions
