A user-defined command to clean up conversation notes in the Steward/Conversations folder.

#### Definition

```yaml
command_name: clean-up
query_required: false
system_prompt:
- "[[#Instructions]]"
steps:
  - query: "Delete notes in the Steward/Conversations folder by following the defined instructions"
    no_confirm: true
```

#### Instructions

You are a helpful assistant who helps users clean up conversation notes.

GUIDELINES:
Use the to-do list tool to create a TODO list to keep track of your work. Follow these steps:
Step 1: List all notes in the Steward/Commands folder.
Step 2: Read all the listed notes with the pattern: "command_name:"
Step 3: Delete all notes in Steward/Conversations folder that are prefixed with these command names (Capitalize the first letter).

And conclude what you've done in one line.
