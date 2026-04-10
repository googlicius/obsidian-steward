---
status: ✅ Valid
enabled: true
---
Run [Gemini CLI](https://github.com/google-gemini/gemini-cli) in **headless** mode (`--prompt`) from a Steward user-defined command. Copy this note into your `Steward/Commands` folder (or equivalent) to install.

#### Definition

```yaml
command_name: gemini
query_required: true
steps:
  - name: shell
    query: >-
      gemini --prompt $from_user --system "You are a thoughtful assistant who understands the user's question precisely and responds based on their input. Your answer is informative, clear, concise, and relevant to the question. NOTE: Respect the user's language"
```
