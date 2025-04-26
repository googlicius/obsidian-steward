const en = {
	translation: {
		// Move result messages
		move: {
			foundFiles: 'I found {{count}} file matching your query.',
			foundFiles_plural: 'I found {{count}} files matching your query.',
			successfullyMoved: 'Successfully moved {{count}} file:',
			successfullyMoved_plural: 'Successfully moved {{count}} files:',
			skipped: 'Skipped {{count}} file (already in destination):',
			skipped_plural: 'Skipped {{count}} files (already in destination):',
			failed: 'Failed to move {{count}} file:',
			failed_plural: 'Failed to move {{count}} files:',
			multiMoveHeader: 'I performed {{count}} move operation:',
			multiMoveHeader_plural: 'I performed {{count}} move operations:',
			operation: 'Operation {{num}}: Moving files with {{query}} to {{folder}}',
			noFilesFound:
				"I couldn't find any files matching your query. Please try a different search term.",
			createFoldersHeader: 'I need to create the following folders before moving files:',
			createFoldersQuestion: 'Would you like me to create these folders?',
		},
		// Search result messages
		search: {
			found: 'I found {{count}} result:',
			found_plural: 'I found {{count}} results:',
			noResults: 'No results found. Would you like to try a different search term?',
			matches: 'Matches:',
			moreMatches: '... and {{count}} more match',
			moreMatches_plural: '... and {{count}} more matches',
			showMoreDetails: 'Type `/more` to show the next 10 results.',
			noMatchesInFile: 'No keyword matches found in this file content.',
			pagination: 'Page {{current}} of {{total}}',
			useMoreCommand: 'Type `/more` to see the next page of results.',
			noMoreResults: 'No more search results to show.',
			noRecentSearch: 'No recent search found. Please run a search command first.',
			moreResults: 'Here are more search results:',
			paginationStatus: 'Page {{current}} of {{total}} ({{count}} total results)',
			noMorePages: 'This is the last page of results.',
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
			welcomeMessage: 'Welcome to your always-available Steward chat. Type below to interact.',
			commandPlaceholder: 'Press Shift+Enter to send',
		},
		// Conversation states
		conversation: {
			workingOnIt: 'Working on it...',
			generating: 'Generating...',
			moving: 'Moving...',
			searching: 'Searching...',
			calculating: 'Calculating...',
		},
	},
};

export default en;
