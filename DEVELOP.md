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
- [ ] Extract user's intent correctly based on the context
      Given a query: "I made a mistake, please help me delete it"
      If the PREVIOUS command is "Adding a tag to notes", Then this will NOT be classified as "delete_from_search_result"
- [ ] Recommendation, based on recently activities.
- [ ] Understanding the current user intent, for example: If user updating a bulleted list to a numbered list, suggest to update the whole list.
- [ ] Maintain a classify_reliably score (start with a moderate score) to mitigate classification mistakes.
      And this score is increase over time. Classified scores from user's queries is used for intent extraction until it reaches a high score.
- [ ] Rename those commands move, copy, etc from the search results to "from the artifact"
- [ ] Add a post-processor to build the custom callout HTML data properties from the HTML comment in the callout:
      `>[!search-result] <!--DATA:line:4,pos:0-->`
