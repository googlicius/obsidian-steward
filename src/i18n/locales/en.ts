const en = {
  translation: {
    common: {
      noFilesFound:
        "I couldn't find any files matching your query. Please try a different search term.",
      noRecentOperations: 'No recent operations found.',
      abortedByLowConfidence: 'Aborted by low confidence.',
      noToolCallFound: 'No tool call found.',
      lowConfidenceConfirmation:
        "I'm not entirely sure about this request. Would you like me to proceed anyway?",
      artifactCreated: 'Artifact {{type}} is created',
      availableCommands: 'Available Commands',
      builtInCommands: 'Built-in Commands',
      userDefinedCommands: 'User-Defined Commands',
      noUserDefinedCommands: "You don't have any user-defined commands yet.",
      intentCommands: 'Intent-Based Commands',
      intentCommandsDesc: 'These commands are available through natural language processing',
      commandHelpText: 'Type any command followed by your query to use it.',
      searchDesc: 'Search for notes in your vault',
      closeDesc: 'Close the current conversation',
      confirmDesc: 'Confirm or reject operations',
      imageDesc: 'Generate images',
      audioDesc: 'Generate audio from text',
      createDesc: 'Create new notes',
      stopDesc: 'Stop ongoing operations',
      helpDesc: 'Show this help message',
      moveDesc: 'Move files to another location',
      copyDesc: 'Copy files to another location',
      deleteDesc: 'Delete files',
      updateDesc: 'Update file content',
      generateDesc: 'Generate content with AI',
      readDesc: 'Read content from notes',
      revertDesc: 'Undo previous changes',
      thankDesc: 'Express gratitude',
    },
    // Chat UI elements
    chat: {
      newChat: 'New Chat',
      history: 'History',
      closeChat: 'Close Chat',
      stewardChat: 'Steward Chat',
      closeConversation: 'Close Conversation',
      conversationClosed: 'Conversation closed',
    },
    // Media generation messages
    media: {
      invalidCommand: 'Invalid media generation command',
      generationFailed: 'Failed to generate {{type}}: {{error}}',
      generationError: 'Error generating media: {{error}}',
    },
    // Move result messages
    move: {
      noSearchResultsFoundAbortMove: 'No search results found, aborting move command',
      foundFiles_one: 'I found {{count}} file matching your query.',
      foundFiles_other: 'I found {{count}} files matching your query.',
      successfullyMoved_one: 'Successfully moved {{count}} file:',
      successfullyMoved_other: 'Successfully moved {{count}} files:',
      skipped_one: 'Skipped {{count}} file (already in destination):',
      skipped_other: 'Skipped {{count}} files (already in destination):',
      failed_one: 'Failed to move {{count}} file:',
      failed_other: 'Failed to move {{count}} files:',
      multiMoveHeader: 'I performed {{count}} move operation:',
      multiMoveHeader_plural: 'I performed {{count}} move operations:',
      operation: 'Operation {{num}}: Moving files with {{query}} to {{folder}}',
      createFoldersHeader: 'I need to create the following folders before moving files:',
      createFoldersQuestion: 'Would you like me to create these folders?',
    },
    // Copy result messages
    copy: {
      noSearchResultsFoundAbortCopy: 'No search results found, aborting copy command',
      foundFiles_one: 'I found {{count}} file to copy.',
      foundFiles_other: 'I found {{count}} files to copy.',
      successfullyCopied_one: 'Successfully copied {{count}} file:',
      successfullyCopied_other: 'Successfully copied {{count}} files:',
      skipped_one: 'Skipped {{count}} file (already exists in destination):',
      skipped_other: 'Skipped {{count}} files (already exist in destination):',
      failed_one: 'Failed to copy {{count}} file:',
      failed_other: 'Failed to copy {{count}} files:',
      multiCopyHeader: 'I performed {{count}} copy operation:',
      multiCopyHeader_plural: 'I performed {{count}} copy operations:',
      operation: 'Operation {{num}}: Copying files with {{query}} to {{folder}}',
      noDestination: 'Please specify a destination folder for the copy operation.',
      createFoldersHeader: 'I need to create the following folders before copying files:',
      createFoldersQuestion: 'Would you like me to create these folders?',
      tooManyFilesConfirm: 'I am about to copy {{count}} files. Are you sure you want to proceed?',
    },
    create: {
      success_one: 'Successfully created {{noteName}}',
      success_other: 'Successfully created {{count}} notes: {{noteNames}}',
      creatingNote: 'Creating note: {{noteName}}',
      confirmMessage_one: 'I will create the following note:',
      confirmMessage_other: 'I will create the following notes:',
      confirmPrompt: 'Do you want to proceed?',
    },
    generate: {
      success: 'Successfully generated',
    },
    // Command-specific messages
    stop: {
      stopped: 'Generation stopped.',
      stoppedWithCount_one: 'Stopped {{count}} active operation.',
      stoppedWithCount_other: 'Stopped {{count}} active operations.',
      noActiveOperations: 'No active operations to stop.',
    },
    // Update result messages
    update: {
      failed_one: 'Failed to update {{count}} file:',
      failed_other: 'Failed to update {{count}} files:',
      successfullyUpdated_one: 'Successfully updated {{count}} file:',
      successfullyUpdated_other: 'Successfully updated {{count}} files:',
      foundFiles_one: 'I found {{count}} file to update.',
      foundFiles_other: 'I found {{count}} files to update.',
      skipped_one: 'Skipped {{count}} file:',
      skipped_other: 'Skipped {{count}} files:',
      applyChangesConfirm: 'Would you like me to apply the changes?',
    },
    // Delete result messages
    delete: {
      foundFiles_one: 'I found {{count}} file to delete.',
      foundFiles_other: 'I found {{count}} files to delete.',
      successfullyDeleted_one: 'Successfully deleted {{count}} file:',
      successfullyDeleted_other: 'Successfully deleted {{count}} files:',
      failed_one: 'Failed to delete {{count}} file:',
      failed_other: 'Failed to delete {{count}} files:',
      multiDeleteHeader: 'I performed {{count}} delete operation:',
      multiDeleteHeader_plural: 'I performed {{count}} delete operations:',
      operation: 'Operation {{num}}: Deleting files with {{query}}',
      confirmHeader: 'I found the following files to delete:',
      confirmQuestion: 'Are you sure you want to delete these files? This action cannot be undone.',
    },
    // Search result messages
    search: {
      found_one: 'I found {{count}} result:',
      found_other: 'I found {{count}} results:',
      noResults: 'No results found. Would you like to try a different search term?',
      matches: 'Matches:',
      moreMatches: '... and {{count}} more match',
      moreMatches_plural: '... and {{count}} more matches',
      showMoreDetails: 'Type `/more` to show the next 10 results.',
      pagination: 'Page {{current}} of {{total}}',
      useMoreCommand: 'Type `/more` to see the next page of results.',
      noMoreResults: 'No more search results to show.',
      noRecentSearch: 'No recent search found. Please run a search command first.',
      moreResults: 'Here are more search results:',
      paginationStatus: 'Page {{current}} of {{total}} ({{count}} total results)',
      noMorePages: 'This is the last page of results.',
      searchingFor: 'Searching for "{{searchTerm}}"',
      searchingForTags: 'Searching for tags: {{tags}}',
      showingPage: 'Showing page {{page}} of {{total}}',
    },
    // Close command messages
    close: {
      instruction: 'To close this conversation, use the /close command in your note.',
      completed: 'Conversation has been closed.',
    },
    // Confirmation messages
    confirmation: {
      notUnderstood: "I didn't understand your response. Please respond with 'yes' or 'no'.",
      noPending: 'There are no pending confirmations to respond to.',
      operationCancelled: 'Operation cancelled.',
      errorProcessing: 'Error processing confirmation: {{errorMessage}}',
    },
    // UI elements
    ui: {
      openStewardChat: 'Open Steward Chat (Ctrl+Shift+L)',
      buildingSearchIndex: 'Building search index...',
      errorBuildingSearchIndex: 'Error building search index. Check console for details.',
      buildingIndexes: 'Steward: Building indexes...',
      noActiveEditor: 'No active editor to close conversation: {{conversationTitle}}',
      conversationLinkNotFound: 'Could not locate the conversation link for {{conversationTitle}}',
      errorClosingConversation: 'Error closing conversation: {{errorMessage}}',
      errorCreatingNote: 'Error creating conversation note: {{errorMessage}}',
      noteNotFound: 'Conversation note not found: {{notePath}}',
      errorUpdatingConversation: 'Error updating conversation: {{errorMessage}}',
      searchIndexNotFound: 'Search index not found. Will build index shortly...',
      errorBuildingInitialIndexes:
        'Steward: Error building initial indexes. Check console for details.',
      decryptionError: 'Failed to decrypt API key. Please re-enter it in settings.',
      encryptionError: 'Failed to encrypt API key. Please try again.',
      welcomeMessage:
        'Welcome to your always-available Steward chat. Type below to interact or type `/ ?` to see available commands.',
      commandPlaceholder: 'Press Enter to send',
    },
    read: {
      noContentFound: 'No such content found in the editor.',
      readEntireContentConfirmation:
        'I am about to read the entire content of the note. Are you sure you want to proceed?',
      unableToReadContent: 'Unable to read content.',
    },
    // Thank you responses
    thankYou: {
      response1: "You're welcome! Happy to help.",
      response2: 'My pleasure! Is there anything else you need?',
      response3: 'Glad I could assist!',
      response4: 'Anytime! Let me know if you need anything else.',
      response5: 'Happy to be of service!',
      simpleResponse: "You're welcome 😊",
    },
    // Conversation states
    conversation: {
      orchestrating: 'Orchestrating...',
      generating: 'Generating...',
      generatingImage: 'Generating image...',
      generatingAudio: 'Generating audio...',
      moving: 'Moving...',
      searching: 'Searching...',
      calculating: 'Calculating...',
      reverting: 'Reverting changes...',
      revertSuccess: 'Successfully reverted the last change.',
      revertFailed: 'Failed to revert changes. No previous changes to revert to.',
      copying: 'Copying...',
      deleting: 'Deleting...',
      updating: 'Updating...',
      creatingPrompt: 'Creating custom prompt...',
      creating: 'Creating...',
      readingContent: 'Reading content...',
    },
  },
};

export default en;
