const ja = {
	translation: {
		// Move result messages
		move: {
			foundFiles: 'クエリに一致するファイルが{{count}}件見つかりました。',
			foundFiles_plural: 'クエリに一致するファイルが{{count}}件見つかりました。',
			successfullyMoved: '{{count}}件のファイルを移動しました：',
			successfullyMoved_plural: '{{count}}件のファイルを移動しました：',
			skipped: '{{count}}件のファイルをスキップしました（既に宛先に存在します）：',
			skipped_plural: '{{count}}件のファイルをスキップしました（既に宛先に存在します）：',
			failed: '{{count}}件のファイルの移動に失敗しました：',
			failed_plural: '{{count}}件のファイルの移動に失敗しました：',
			multiMoveHeader: '{{count}}件の移動操作を実行しました：',
			multiMoveHeader_plural: '{{count}}件の移動操作を実行しました：',
			operation: '操作{{num}}：{{query}}に一致するファイルを{{folder}}に移動',
			noFilesFound: 'クエリに一致するファイルが見つかりませんでした。別の検索語を試してください。',
			createFoldersHeader: 'ファイルを移動する前に、次のフォルダを作成する必要があります：',
			createFoldersQuestion: 'これらのフォルダを作成しますか？',
		},
		// Search result messages
		search: {
			found: '{{count}}件の結果が見つかりました：',
			found_plural: '{{count}}件の結果が見つかりました：',
			noResults: '結果が見つかりませんでした。別の検索語を試しますか？',
			matches: '一致項目：',
			moreMatches: '... その他{{count}}件の一致項目',
			moreMatches_plural: '... その他{{count}}件の一致項目',
			showMoreDetails: '特定の結果の詳細を表示しますか？',
		},
		// Close command messages
		close: {
			instruction: 'この会話を閉じるには、ノートで /close コマンドを使用してください。',
			completed: '会話が閉じられました。',
		},
		// Confirmation messages
		confirmation: {
			notUnderstood: '応答が理解できませんでした。「はい」または「いいえ」で応答してください。',
			noPending: '応答待ちの確認は現在ありません。',
			operationCancelled: '操作がキャンセルされました。',
			errorProcessing: '確認処理中にエラーが発生しました：{{errorMessage}}',
		},
		// UI elements
		ui: {
			openStewardChat: 'スチュワードチャットを開く',
			buildingSearchIndex: '検索インデックスを構築中...',
			errorBuildingSearchIndex: '検索インデックスの構築中にエラーが発生しました。詳細はコンソールを確認してください。',
			buildingIndexes: 'スチュワード：インデックスを構築中...',
			noActiveEditor: 'アクティブなエディタがありません：{{conversationTitle}}',
			conversationLinkNotFound: '{{conversationTitle}}の会話リンクが見つかりませんでした',
			errorClosingConversation: '会話を閉じる際にエラーが発生しました：{{errorMessage}}',
			errorCreatingNote: '会話ノートの作成中にエラーが発生しました：{{errorMessage}}',
			noteNotFound: '会話ノートが見つかりません：{{notePath}}',
			errorUpdatingConversation: '会話の更新中にエラーが発生しました：{{errorMessage}}',
			searchIndexNotFound: '検索インデックスが見つかりません。まもなくインデックスを構築します...',
			errorBuildingInitialIndexes: 'スチュワード：初期インデックスの構築中にエラーが発生しました。詳細はコンソールを確認してください。',
			decryptionError: 'APIキーの復号化に失敗しました。設定で再入力してください。',
			encryptionError: 'APIキーの暗号化に失敗しました。もう一度お試しください。',
			welcomeMessage: 'いつでも利用可能なスチュワードチャットへようこそ。以下に入力して対話してください。',
		},
		// Conversation states
		conversation: {
			workingOnIt: '処理中...',
			generating: '生成中...',
		},
	},
};

export default ja;
