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
- [ ] Maintain a classify_reliably score (start with a moderate score) to mitigate classification mistakes.
      And this score is increase over time. Classified scores from user's queries is used for intent extraction until it reaches a high score.
- [x] Rename those commands move, copy, etc from the search results to "from the artifact"
- [x] Add a post-processor to build the custom callout HTML data properties from the HTML comment in the callout:
      `>[!search-result] line:4,pos:0`
- [x] Refactor the handleConversationCommand to be able to handle a confirmation in the between or stop immediately if errors happen when there are multiple commands
- [x] Search words start with a keyword: If user search for "teem", should be returned "teeming"
- [x] The "create" command should be able to handle creating multiple notes.
- [x] If the user wants to read a file entirely at the first time, let them know about the potential high cost by a confirmation.
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
- [x] Toggle show/hide pronouns. Pronouns could look redundant; Let the user decide whether to show them or not.
- [ ] Adds a command prefix input to the setting. Default is `/`. This allow the user to change the prefix if the default conflicts with their use.
- [x] Provide the extraction step a tool allowing LLMs retrieve more info about the extracted commands to build their queries precisely.
      For example: This query: "Read the Hold Out note" need to be extracted to a more meaningful query for the read command instead of "Hold Out".
- [ ] Extend read extraction functionality: Allow LLM to read enough data before going further
      For example: The user wants to read the paragraph above and ask for something. But the paragraph is still mention "above" or a note, suggests there is something out of the paragraph. So the LLM needs to read it to collect enough data.
- [x] When reloading a read command, ensure the cursor position is correct, whether telling the user or store it in the metadata.
- [ ] Ensure the highlightKeywords function has the same behavior as the tokenizer.normalizers.
- [x] Add search records per page setting
- [x] Test these queries:
      [x] Append "Hello word" to the note 2025-07-24 (In chat, Gemini)
      [ ] Read the question above and tell me the result. Refer to the Operator note to get the operator
- [x] Add a Copy button to the search result callout.
- [x] The selection text should be added at the end of the input. Currently, it's added at the head of the input.
- [x] When users send query "yes/no", if there no current conformation, leave it as the other queries.
- [x] Create a "Squeeze" button to squeeze a conversation into a small button that can expand to a normal conversation.
- [x] Search all files
- [x] Conversation summarization
- [x] LLM extraction for classified queries: We still need LLMs help to extract those to specific queries for each command. A light version for extract queries for a list of defined commands.
- [x] Serialize and store artifacts directly in the conversation that persists when users reopen the app.
- [x] Add multiple operations confirmation. Ensuring the LLM's extraction is expected. For example this query: "Move the note tagged #test in the root folder to the Archived folder" sometimes being extracted to 2 operations {tag: #test}, {folder: "^/$}. Which is incorrect.
- [ ] Configure models for each stage: summarization, extraction, generate, etc.
- [x] Toggle extraction explanation, to demonstrate the user what it going to do.
- [ ] Don't include the content of wikilinks automatically. Let the extraction decide it. But the downstream commands like `generate` are still able to include the content itself if it is not presented in the context.
- [ ] Provide a unify solution allows each command can retrieve context itself.
- [ ] Make another UDC demo: Is there any LOVE in violence? Is there any bilateral solution between Gandalf and Sauron?
- [x] Context Augmentation: When the confidence is low, evaluate the current extraction, request another extraction with all current context: read results, etc. And continue the process with the new extraction.
- [x] Search files with only mentioned type.
- [ ] When a generate command isn't have enough context, it can directly use commands like search and read for context augmentation.
- [ ] Add a new step to evaluate the results if it is satisfied the user's query.
      For example: Some models extract this query as only one read command: "<selectedText> Help me update the table, check the Instructions note to get the instructions.". Which is incorrect.
- [x] Add the ability to the frontend side to enrich the context if LLMs don't work properly.
      Pass the selection to the downstream commands.
- [ ] Add search settings: Proximity threshold, Coverage configure.
- [x] Offline search: exact and contain.
- [x] Classify dynamic threshold
- [ ] Auto build search index
- [ ] Build index for PDF files
- [ ] Stw squeezed block in reading view
- [x] 2-step extraction to reduce the complexity of the system prompt for extraction the user's query, Step 1, extract only command names. Step2, build query for each extracted commands from the step 1.
- [ ] 2-phrase processing to strengthen the context before editing or generating. Step 1: Collecting data using "read" or "search" command. Step 2: Generate or editing using "generate", "update", "delete", "copy", etc, commands.
- [ ] Add the new Steward folder to the excluded folders.
- [x] When users clicking on the reload button of a message, remove ALL artifacts below that message.
- [x] Provide a clean assistant-user' request/response flow with consistent ID: User sends queries: 1. Assistant send request (request_id) to read. The user response with a reading result (include the request_id)
- [ ] Save embedding only when the command sequence is completed.
- [ ] Enhance summarization: Only check generated_content, note content_update for generate commands.
- [x] Large updates: Tables, lists, paragraphs,...
- [ ] Evaluation council: A set of different models participating in evaluating the unqualified outcomes: low confidence, errors,...
- [ ] Confirmation as a tool: Allow LLM decide the confirmation so we can send a flexible query (maybe to put more classify) instead of just Yes and No

### BUGS

- [ ] The LLM is extracted this query incorrect: "Read the question above and tell me the result. Refer to this note [[Operator]] to get the operator". The extraction includes 2 tool calls with the same type: above. One has noteName: Operator.
      **Solution:** Either fine-tunning the content reading prompt to tell LLMs use correct tool params or
      include all content of any wikilinks along with the user query.
- [x] The systemPrompts in the User-Defined command currently load content from wikilinks only one level (Need 2 levels to resolve content of wikilinks in the system prompt)
- [x] Double user messages in the actual generate.
- [x] Cannot stop

### CONTEXT ENGINEERING

1. Use JSON format to present schemas need to be enforced.
2. Simplified instructions/system prompts by including the necessary and related to the current query/context.
3. Don't ask LLM repeat or copy something, specially complicated patterns. The larger the content the higher risk the model making mistakes. Ask for sending placeholders instead and the client will process to transform placeholders into the actual contents.
4. Use IDs to connect things together, for example: If the model uses a tool call, attach the same ID (toolCallID) to the tool call request and the result.
5. Test the outcomes with as many models as possible. Each model has their own approach of resolving the query and tool usage.
6. Specialized agents can process some related tasks beyond their capacity by requesting other agents for more context.
7. Repair model's responses in-flight that are still correct but varies due to their creativity/randomness.
8. Option to see human-readable explanation (YAML) about what it did.
