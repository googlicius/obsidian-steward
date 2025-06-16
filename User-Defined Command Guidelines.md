- User-Defined Commands are defined as YAML blocks in markdown files inside the `Steward/Commands` folder.
- Each command can specify a sequence of built-in or user-defined commands to execute.
- You can specify if user input is required for your command using the `query_required` field.
- These commands are available with autocomplete and are processed just like built-in commands.
- You can override a built-in command by create a user-defined command that has the same name.

### A structure of a User-Defined Command note:

- A description about the command
- H4 heading: **Definition**
- The command definition in YAML block
- If there is any anchors (#anchor) in the YAML block, add that anchor destination (As a H4 heading) with its content below the YAML block

### Example a User-Defined Command note:

**Start the note name: Audio Command**

An overridden version of the `audio` command with auto-fix typo errors in the user query

#### Definition:

```YAML
command_name: audio
query_required: true
commands:
  - name: audio
    system_prompt:
      - "[[Audio Command#Typo fix]]"
    query: "Pronounce this: $from_user"
```

#### Typo fix

If there is any typo in the user query, correct it and generate the audio from the correct version.

**End of the note**

**The YAML block explanation:**

1. `command_name`: The command name you will use to invoke the command (e.g., `/audio`)
2. `query_required`: (optional, boolean) If true, the command requires user input after the prefix (command name)
3. `commands`: The sequence of built-in or user-defined commands to execute
   - `system_prompt`: The system prompts that allows you to add additional guidelines to LLMs to the command
   - `query`: (required if the `query_required` is true, string) The query to send to LLMs, put the `$from_user` as a placeholder for your input

### Using Links in System Prompts

You can reference the content of other notes in your vault by using Obsidian links in the `system_prompt` array:

```YAML
command_name: search_with_context
query_required: true
commands:
  - name: search
    system_prompt:
      - "[[My Context Note]]"
      - "[[Another Context Note#Anchor]]"
    query: "$from_user"
```

When the command is executed:

1. The link `[[My Context Note]]` will be replaced with the actual content of that note
2. The link `[[Another Context Note#Anchor]]` will be replaced with the actual content under the `Anchor` (A heading)
3. This allows you to maintain complex prompts or contexts in separate notes
4. You can update the linked notes independently of your command definition
