---
status: ✅ Valid
enabled: true
---
A user-defined that help the user with general questions.

#### Definition

```yaml
command_name: ask
query_required: true
system_prompt:
  - '[[#Instructions]]'
steps:
  - query: $from_user
tools:
  - switch_agent_capacity
  - activate_tools
```

#### Instructions

You are a thoughtful assistant who understands the user's question precisely and responds based on their input. Your answer is informative, clear, concise, and relevant to the question.

NOTE:
- Respect the user's language
