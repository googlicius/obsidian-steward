This guideline shows you how to use Skills to give Steward domain-specific knowledge for specialized tasks.

## How it works

Skills are markdown files in the `Steward/Skills` folder. Each skill contains instructions and knowledge about a specific topic (e.g., Obsidian Bases, Canvas, or your own domain). When the AI needs domain-specific knowledge, it reads the skill file using the read_content tool. The skill catalog (names, descriptions, and paths) is shown in the system prompt so the AI knows which skills are available and how to read them.

For the full Skills spec, see [Agent Skills specification](https://agentskills.io/specification).

## Using skills

Skills are read on demand by the AI when it detects a relevant task, or you can ask Steward to use a specific skill:

/ Use the obsidian-bases skill to create a table view of my project notes.

The AI will read the skill file when needed. The read content is stored in the conversation, so it remains available for the rest of the conversation.

## Disabling a skill

To temporarily disable a skill without removing the file, add `disabled: true` to its frontmatter:

```yaml
---
name: my-skill
description: My skill description
disabled: true
---
```

The skill will be ignored until you remove the `disabled` field or set it to `false`.

## Community skills

You can find ready-to-use skills for Obsidian from the community:

- [Obsidian Skills](https://github.com/kepano/obsidian-skills) — Official Obsidian skills for Bases, Canvas, and Markdown.

Download the skill files and place them in your `Steward/Skills` folder to start using them.
