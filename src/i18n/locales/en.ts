const en = {
	translation: {
		common: {
			noFilesFound:
				"I couldn't find any files matching your query. Please try a different search term.",
		},
		// Media generation messages
		media: {
			invalidCommand: 'Invalid media generation command',
			generationFailed: 'Failed to generate {{type}}: {{error}}',
			generationError: 'Error generating media: {{error}}',
		},
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
			createFoldersHeader: 'I need to create the following folders before moving files:',
			createFoldersQuestion: 'Would you like me to create these folders?',
		},
		// Copy result messages
		copy: {
			foundFiles: 'I found {{count}} file to copy.',
			foundFiles_plural: 'I found {{count}} files to copy.',
			successfullyCopied: 'Successfully copied {{count}} file:',
			successfullyCopied_plural: 'Successfully copied {{count}} files:',
			skipped: 'Skipped {{count}} file (already exists in destination):',
			skipped_plural: 'Skipped {{count}} files (already exist in destination):',
			failed: 'Failed to copy {{count}} file:',
			failed_plural: 'Failed to copy {{count}} files:',
			multiCopyHeader: 'I performed {{count}} copy operation:',
			multiCopyHeader_plural: 'I performed {{count}} copy operations:',
			operation: 'Operation {{num}}: Copying files with {{query}} to {{folder}}',
			noDestination: 'Please specify a destination folder for the copy operation.',
			createFoldersHeader: 'I need to create the following folders before copying files:',
			createFoldersQuestion: 'Would you like me to create these folders?',
		},
		// Delete result messages
		delete: {
			foundFiles: 'I found {{count}} file to delete.',
			foundFiles_plural: 'I found {{count}} files to delete.',
			successfullyDeleted: 'Successfully deleted {{count}} file:',
			successfullyDeleted_plural: 'Successfully deleted {{count}} files:',
			failed: 'Failed to delete {{count}} file:',
			failed_plural: 'Failed to delete {{count}} files:',
			multiDeleteHeader: 'I performed {{count}} delete operation:',
			multiDeleteHeader_plural: 'I performed {{count}} delete operations:',
			operation: 'Operation {{num}}: Deleting files with {{query}}',
			confirmHeader: 'I found the following files to delete:',
			confirmQuestion: 'Are you sure you want to delete these files? This action cannot be undone.',
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
		},
	},
};

export default en;
