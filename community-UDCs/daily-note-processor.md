# Daily Note Processor

A user-defined command with triggers that automatically processes daily notes when they are created.

## Command Definition

```yaml
command_name: daily_note_processor
query_required: false
triggers:
  - events: [create]
    patterns:
      folders: ['Daily Notes']
commands:
  - name: read
    query: 'Read the content of $file_name'
  - name: generate
    system_prompt:
      - 'You are a helpful assistant that processes daily notes.'
      - 'Extract tasks, appointments, and important items.'
      - 'Create a structured summary with sections: Tasks, Appointments, Notes.'
    query: 'Process the daily note and create a structured summary'
```

## How It Works

1. When a new file is created in the "Daily Notes" folder
2. The trigger automatically activates
3. A new conversation note is created in `Steward/Triggered/daily_note_processor-{timestamp}`
4. The command reads the daily note content
5. Generates a structured summary with tasks, appointments, and notes
6. You can review and interact with the results in the conversation note

## Use Cases

- Automatic extraction of tasks from daily notes
- Creating structured summaries of daily activities
- Identifying important items that need follow-up
- Building a habit of organized daily planning
