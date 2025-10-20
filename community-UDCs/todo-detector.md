# TODO Detector

A user-defined command with triggers that automatically detects and processes files containing TODO items when they are modified.

## Command Definition

```yaml
command_name: todo_detector
query_required: false
triggers:
  - events: [modify]
    patterns:
      content: '\\[ \\]|TODO:|FIXME:|\\#todo'
commands:
  - name: read
    query: 'Read content from $file_name'
  - name: generate
    system_prompt:
      - 'You are a helpful assistant that extracts and organizes TODO items.'
      - 'Find all TODO items, checkboxes, FIXME comments, and #todo tags.'
      - 'Create a prioritized task list with categories.'
    query: 'Extract all TODO items and create a structured task list'
```

## How It Works

1. When any file is modified in the vault
2. The system checks if the content contains TODO patterns (checkboxes, TODO:, FIXME:, #todo)
3. If matched, the trigger automatically activates
4. A new conversation note is created with extracted TODO items
5. AI organizes and categorizes the tasks
6. You can review the generated task list in the conversation note

## Content Pattern Explanation

The regex pattern `\\[ \\]|TODO:|FIXME:|\\#todo` matches:

- `[ ]` - Unchecked markdown checkboxes
- `TODO:` - TODO comments
- `FIXME:` - FIXME comments
- `#todo` - Todo hashtags

## Use Cases

- Automatic task extraction from meeting notes
- Tracking action items across your vault
- Finding FIXME comments in code documentation
- Building a centralized task dashboard
- Never losing track of unchecked items

## Workflow Example

1. You're editing `Projects/new-feature.md` and add:
   ```
   - [ ] Implement authentication
   - TODO: Write tests
   - FIXME: Fix the login bug
   ```
2. When you save the file, the trigger activates
3. AI generates a structured task list in a conversation note
4. You can now track all tasks in one place
