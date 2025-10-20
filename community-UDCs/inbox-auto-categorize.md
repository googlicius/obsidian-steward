# Inbox Auto-Categorizer

A user-defined command with triggers that automatically categorizes files when they are created in the Inbox folder.

## Command Definition

```yaml
command_name: inbox_categorizer
query_required: false
triggers:
  - events: [create]
    patterns:
      folders: ['Inbox']
commands:
  - name: read
    query: 'Read the content of $file_name'
  - name: generate
    system_prompt:
      - 'You are a helpful assistant that categorizes and organizes notes.'
      - 'Analyze the content and suggest:'
      - '1. The most appropriate folder to move this note to'
      - '2. Relevant tags to add'
      - '3. Any frontmatter properties that would be useful'
      - 'Provide specific, actionable recommendations.'
    query: 'Analyze this note and suggest how to organize it in my vault'
```

## How It Works

1. When a new file is created in the "Inbox" folder
2. The trigger automatically activates
3. A new conversation note is created with categorization suggestions
4. The command reads the inbox file content
5. Generates recommendations for:
   - Target folder
   - Relevant tags
   - Frontmatter properties
6. You can review the suggestions and manually organize the file

## Use Cases

- Quick capture workflow: create notes in Inbox, let AI suggest organization
- Reducing friction in note-taking process
- Maintaining consistent organization structure
- Getting suggestions for tagging and categorization
- Building a smart filing system

## Workflow Example

1. Create a quick note in `Inbox/meeting-ideas.md`
2. Trigger automatically processes the note
3. AI suggests moving to `Meetings/` folder with tags `#meeting #ideas`
4. You review and apply the suggestions manually
