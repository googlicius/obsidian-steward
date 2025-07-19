# Development

- [x] Remove stopwords from the updating file and compare with the original before indexing.
- COMMAND CHAINING
  - [x] Storing the artifacts of the current conversation.
  - [ ] Get the artifact automatically, for example, after restart the app, users ask "Move them to the Done folder". It should be able to search again based on the previous search query (if any) and then move "them" to the destination.
- [x] Reduce prompt repeating, for example in the move prompt still including some parts of the search prompt.
- [ ] Build more sophisticated commands make it able to users to modify even predefined commands the way they want.
- [x] Add more Obsidian tools: creation, modification, and deletion of notes
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
- [x] Rename those commands move, copy, etc from the search results to "from the artifact"
- [x] Add a post-processor to build the custom callout HTML data properties from the HTML comment in the callout:
      `>[!search-result] line:4,pos:0`
- [x] Refactor the handleConversationCommand to be able to handle a confirmation in the between or stop immediately if errors happen when there are multiple commands
- [ ] Search words start with a keyword: If user search for "teem", should be returned "teeming"
- [x] The "create" command should be able to handle creating multiple notes.
- [x] If the user wants to read a file entirely at the first time, let them know about the potential high cost by a confirmation.
- [ ] The user can suggest their name or nickname to Steward to display it in the chat instead of "User"
- [ ] Add read_history command when LLM wants to know more about the current context
- [ ] Settings with the LLM helps: audio generation model, text generation model, names, and temperature
- [x] Remove MediaGenerationService
- [x] Send the provided images along with the text
- [x] /create Help me create a user-defined command name Steward/Commands/Audio Command that override the built-in audio command with the ability to fix the typo automatically and use the correct typo version to generate audio. The guidance of fixing typo should be place under a heading section in the same note with the command definition, please refer to this [[User-Defined command guidelines]]
- [ ] User-Defined Command: Provide tools so the LLM can decide which tool should it use to complete the task.
      For example: The LLM decide whether to use `generate` only or include the `update` command
- [ ] Prevent duplicate note content between included content and read content
- [x] Let the LLM aware of artifacts for more transparency by providing a tool to read one or many artifacts if necessary.
- [ ] Edit a message (Using linked list to store a multiple histories in a conversation)
- [x] Acknowledging the conversation history to the LLM while extract user's intent for better extraction.

### BUGS

- [ ] The LLM is extracted this query incorrect: "Read the question above and tell me the result. Refer to this note [[Operator]] to get the operator". The extraction includes 2 tool calls with the same type: above. One has noteName: Operator.
      **Solution:** Either fine-tunning the content reading prompt to tell LLMs use correct tool params or
      include all content of any wikilinks along with the user query.
- [x] The systemPrompts in the User-Defined command currently load content from wikilinks only one level (Need 2 levels to resolve content of wikilinks in the system prompt)
