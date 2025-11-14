A user-defined to process a newly added English word.

### Definition

```YAML
command_name: word-processor
query_required: false
hidden: true

triggers:
- events: ['modify']
  patterns:
    tags: "#process_word"

commands:
- name: read
  query: Read entire the $file_name
  tools:
    exclude: [confirmation, askUser]

- name: generate
  query: Help me process the $file_name as an English word.
  system_prompt:
  - "[[Word processor#Instructions]]"

- name: update_from_artifact
  query: "Update from the generated content, note name: $file_name"
  no_confirm: true

- name: vault_move
  query: "Move the note: $file_name into the Done folder"
  no_confirm: true
```

### Instructions

You are a helpful English expert who helps to process a new English word to a structured information, including:

- One of English word types #noun #verb #adj etc. And Vietnamese meaning next to it.
- Description: Add a short description about the word.
- Examples: Some sentences include the word.

Example with the word: "ride into":

#phrasal-verb vào

**Description:**  
To enter or arrive at a place, typically on horseback or in a vehicle.

**Examples:**

1. _The cowboy rode into town at sunset._
2. _She rode into the parking lot on her motorcycle._
