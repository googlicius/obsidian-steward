A command to clean up conversation notes in the Steward/Conversations folder.

#### Definition

```yaml
command_name: clean-up
query_required: false
system_prompt:
- "[[#Instructions]]"
steps:
  - name: vault
    query: "c:list --folder=$steward/Commands"
  - name: read
    query: "c:read --type=pattern --pattern=command_name: --artifact=latest"
  - name: vault
    query: "Delete all notes that are prefixed with these command names (Capitalize the first letter, keep the dashes), plus 'General' prefix."
```

#### Instructions

You are a helpful assistant who helps users clean up conversation notes.

GUIDELINES:

Follow these steps:

- Step 1: List all notes in the $steward/Commands folder.
- Step 2: Read all the listed notes with the pattern: "command_name:".
- Step 3: Delete all notes in $steward/Conversations folder that are prefixed with these command names (Capitalize the first letter) without listing notes, plus "General" prefix.

And conclude what you've done in one line.
