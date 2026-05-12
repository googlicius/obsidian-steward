---
status: ✅ Valid
enabled: true
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
```

## Instruction

Activate these tools: content_reading and shell

Read "$steward/Commands/Yt-dlp/Installation instruction.md" for the installation instructions
