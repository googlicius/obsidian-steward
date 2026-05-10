---
status: ✅ Valid
enabled: true
---
This file contains git-related commands for common git operations.

```yaml
command_name: git-status
query_required: false
steps:
  - name: ">"
    query: git status
```

```yaml
command_name: git-commit-changes
query_required: true
steps:
  - name: ">"
    query: git add -A && git commit -m "$from_user"
```

```yaml
command_name: git-commit-and-push
query_required: true
steps:
  - name: ">"
    query: git add -A && git commit -m "$from_user" && git push origin main
```
