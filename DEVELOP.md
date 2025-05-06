# Development

- [x] Remove stopwords from the updating file and compare with the original before indexing.
- COMMAND CHAINING
  - [x] Storing the artifacts of the current conversation.
  - [ ] Get the artifact automatically, for example, after restart the app, users ask "Move them to the Done folder". It should be able to search again based on the previous search query (if any) and then move "them" to the destination.
- [x] Reduce prompt repeating, for example in the move prompt still including some parts of the search prompt.
- [ ] Build more sophisticated commands make it able to users to modify even predefined commands the way they want.
- [ ] Add more Obsidian tools: creation, modification, and deletion of notes
- [ ] Agent: Give the AI set of tools, and it will automatically pick appropriate tools to perform its tasks.

- [ ] Commit only files affected by the current actions.
- [ ] Move folder(s) into another folder
- [x] Clustering user's queries based on LLM extraction, so the next similar queries will be classified without LLM helps.
