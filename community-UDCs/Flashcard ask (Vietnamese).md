A user-defined command helps general tasks from the flashcard above the cursor (Vietnamese version).

#### Definition:

```YAML
command_name: flashcard-ask-vi
query_required: true
system_prompt:
  - "[[Flashcard ask#Flashcard guidelines]]"
steps:
  - name: read
    query: |
      Đọc CHỈ MỘT flashcard ở trên, và giúp tôi:
      $from_user
    no_confirm: true
```
