This guideline shows you how to use Skills to give Steward domain-specific knowledge for specialized tasks.

## How it works

Skills are markdown files in the `Steward/Skills` folder. Each skill contains instructions and knowledge about a specific topic (e.g., Obsidian Bases, Canvas, or your own domain). When activated in a conversation, the skill's content is provided to the AI as context so it can handle tasks more effectively.

For the full Skills spec, see [Agent Skills specification](https://agentskills.io/specification).

## Using skills

Skills are activated automatically by the AI when it detects a relevant task, or you can ask Steward to use a specific skill:

/ Use the obsidian-bases skill to create a table view of my project notes.

Once activated, skills persist for the entire conversation. They remain available even after reopening the app.

## Community skills

You can find ready-to-use skills for Obsidian from the community:

- [Obsidian Skills](https://github.com/kepano/obsidian-skills) — Official Obsidian skills for Bases, Canvas, and Markdown.

Download the skill files and place them in your `Steward/Skills` folder to start using them.
