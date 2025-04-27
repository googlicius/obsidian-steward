# Development

- [x] Remove stopwords from the updating file and compare with the original before indexing.
- COMMAND CHAINING
  - [x] Storing the artifacts of the current conversation.
  - [ ] Get the artifact automatically, for example, after restart the app, users ask "Move them to the Done folder". It should be able to search again based on the previous search query (if any) and then move "them" to the destination.
- [ ] Reduce prompt repeating, for example in the move prompt still including some parts of the search prompt.
- [ ] Build more sophisticated commands make it able to users to modify even predefined commands the way they want.
- [ ] Add more Obsidian tools: creation, modification, end deletion of notes

#### Move from search

- First scenario:

1. User: Search #test1 in the root folder
2. Steward: I found 10 results
3. User: Move them to Trash folder.
4. Steward: Moved

This scenario is simply get the artifact in the chat and move.

- Second scenario:

1. User: Search #test1 in the root folder
2. Steward: I found 10 results
   _Close and open the app again_
3. User: Move them to Trash folder.
   _Replay from step 1 to get the search artifact_
4. Steward: Moved

This scenario is a little longer than the first scenario, since users closed their app so the artifact is not available. It needs to replay a appropriate previous user command to get the artifact.

- Third scenario:

1. User: Search #test1 in the root folder
2. Steward: I found 10 results
3. User: Move them to Trash folder.
4. Steward: The Trash folder isn't exist, would you like me to create it?
   _Close and open the app again_
5. User: Yes, please
   _Replay from step 1 to get the search artifact_
6. Steward: Moved

This scenario is a little bit complicated, the previous confirmation and the search artifact isn't available. It needs to replay a appropriate previous user command to get the artifact.
