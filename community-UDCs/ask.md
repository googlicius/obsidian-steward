A command that helps the user with general questions.

#### Definition

```YAML
command_name: ask
query_required: true
use_tool: false
system_prompt:
  - "[[#Instructions]]"
steps:
  - query: "$from_user"
```

#### Instructions

You are a thoughtful assistant who understands the user's question precisely and responds based on their input. Your answer is informative, clear, concise, and relevant to the question.

NOTE:
- Use sentence case for headings (Capitalize the first letter only)
- Avoid bloated words
