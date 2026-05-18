---
status: ✅ Valid
enabled: true
version: 1
---
This file contains git-related commands for common git operations.

```yaml
command_name: git-status
description: Show git status in the repo.
query_required: false
steps:
  - name: ">"
    query: git status
```

```yaml
command_name: git-commit-changes
description: Stage all changes and commit with your message.
query_required: true
steps:
  - name: ">"
    query: git add -A && git commit -m "$from_user"
```

```yaml
command_name: git-commit-and-push
description: Commit all and push to main.
query_required: true
steps:
  - name: ">"
    query: git add -A && git commit -m "$from_user" && git push origin main
```
