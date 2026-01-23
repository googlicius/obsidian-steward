A user-defined command helps general tasks from the flashcard above the cursor (Japanese version).

#### Definition:

```YAML
command_name: flashcard-ask-ja
query_required: true
system_prompt:
  - "[[Flashcard ask#Flashcard guidelines]]"
steps:
  - name: read
    query: |
      カーソルの上にあるフラッシュカードを1つだけ読み取り、以下について手伝ってください：
      $from_user
    no_confirm: true
```
