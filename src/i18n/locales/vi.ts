const vi = {
	translation: {
		common: {
			noFilesFound:
				'Tôi không tìm thấy tập tin nào phù hợp với truy vấn của bạn. Vui lòng thử từ khóa tìm kiếm khác.',
			noRecentOperations: 'Không có thao tác gần đây được tìm thấy.',
		},
		// Chat UI elements
		chat: {
			newChat: 'Cuộc Trò Chuyện Mới',
			history: 'Lịch Sử',
			closeChat: 'Đóng Trò Chuyện',
			stewardChat: 'Trò Chuyện Steward',
			closeConversation: 'Đóng Cuộc Trò Chuyện',
		},
		// Move result messages
		move: {
			foundFiles: 'Tôi đã tìm thấy {{count}} tập tin khớp với truy vấn của bạn.',
			foundFiles_plural: 'Tôi đã tìm thấy {{count}} tập tin khớp với truy vấn của bạn.',
			successfullyMoved: 'Đã di chuyển thành công {{count}} tập tin:',
			successfullyMoved_plural: 'Đã di chuyển thành công {{count}} tập tin:',
			skipped: 'Đã bỏ qua {{count}} tập tin (đã có trong thư mục đích):',
			skipped_plural: 'Đã bỏ qua {{count}} tập tin (đã có trong thư mục đích):',
			failed: 'Không thể di chuyển {{count}} tập tin:',
			failed_plural: 'Không thể di chuyển {{count}} tập tin:',
			multiMoveHeader: 'Tôi đã thực hiện {{count}} thao tác di chuyển:',
			multiMoveHeader_plural: 'Tôi đã thực hiện {{count}} thao tác di chuyển:',
			operation: 'Thao tác {{num}}: Di chuyển các tập tin với {{query}} đến {{folder}}',
			createFoldersHeader: 'Tôi cần tạo các thư mục sau trước khi di chuyển tập tin:',
			createFoldersQuestion: 'Bạn có muốn tôi tạo các thư mục này không?',
		},
		// Copy result messages
		copy: {
			foundFiles: 'Tôi đã tìm thấy {{count}} tập tin để sao chép.',
			foundFiles_plural: 'Tôi đã tìm thấy {{count}} tập tin để sao chép.',
			successfullyCopied: 'Đã sao chép thành công {{count}} tập tin:',
			successfullyCopied_plural: 'Đã sao chép thành công {{count}} tập tin:',
			skipped: 'Đã bỏ qua {{count}} tập tin (đã có trong thư mục đích):',
			skipped_plural: 'Đã bỏ qua {{count}} tập tin (đã có trong thư mục đích):',
			failed: 'Không thể sao chép {{count}} tập tin:',
			failed_plural: 'Không thể sao chép {{count}} tập tin:',
			multiCopyHeader: 'Tôi đã thực hiện {{count}} thao tác sao chép:',
			multiCopyHeader_plural: 'Tôi đã thực hiện {{count}} thao tác sao chép:',
			operation: 'Thao tác {{num}}: Sao chép các tập tin với {{query}} đến {{folder}}',
			noDestination: 'Vui lòng chỉ định thư mục đích cho thao tác sao chép.',
			createFoldersHeader: 'Tôi cần tạo các thư mục sau trước khi sao chép tập tin:',
			createFoldersQuestion: 'Bạn có muốn tôi tạo các thư mục này không?',
		},
		create: {
			success_one: 'Đã tạo thành công {{noteName}}',
			success_other: 'Đã tạo thành công {{count}} ghi chú: {{noteNames}}',
			creatingNote: 'Đang tạo ghi chú: [[{{noteName}}]]',
		},
		generate: {
			success: 'Đã tạo thành công',
			applyChangesConfirm: 'Bạn có muốn áp dụng các thay đổi này không?',
		},
		// Update result messages
		update: {
			failed: 'Không thể cập nhật {{count}} tập tin:',
			successfullyUpdated: 'Đã cập nhật thành công {{count}} tập tin:',
			foundFiles: 'Tôi đã tìm thấy {{count}} tập tin để cập nhật.',
			skipped_one: 'Đã bỏ qua {{count}} tập tin:',
			skipped_other: 'Đã bỏ qua {{count}} tập tin:',
		},
		// Delete result messages
		delete: {
			foundFiles: 'Tôi đã tìm thấy {{count}} tập tin để xóa.',
			foundFiles_plural: 'Tôi đã tìm thấy {{count}} tập tin để xóa.',
			successfullyDeleted: 'Đã xóa thành công {{count}} tập tin:',
			successfullyDeleted_plural: 'Đã xóa thành công {{count}} tập tin:',
			failed: 'Không thể xóa {{count}} tập tin:',
			failed_plural: 'Không thể xóa {{count}} tập tin:',
			multiDeleteHeader: 'Tôi đã thực hiện {{count}} thao tác xóa:',
			multiDeleteHeader_plural: 'Tôi đã thực hiện {{count}} thao tác xóa:',
			operation: 'Thao tác {{num}}: Xóa các tập tin với {{query}}',
		},
		// Search result messages
		search: {
			found: 'Tôi đã tìm thấy {{count}} kết quả:',
			found_plural: 'Tôi đã tìm thấy {{count}} kết quả:',
			noResults: 'Không tìm thấy kết quả nào. Bạn muốn thử từ khóa tìm kiếm khác không?',
			matches: 'Kết quả phù hợp:',
			moreMatches: '... và {{count}} kết quả khác',
			moreMatches_plural: '... và {{count}} kết quả khác',
			showMoreDetails: 'Nhập `/more` để xem thêm 10 kết quả tiếp theo.',
			pagination: 'Trang {{current}}/{{total}}',
			useMoreCommand: 'Nhập `/more` để xem trang kết quả tiếp theo.',
			noMoreResults: 'Không còn kết quả tìm kiếm nào để hiển thị.',
			noRecentSearch: 'Không tìm thấy tìm kiếm gần đây. Vui lòng thực hiện lệnh tìm kiếm trước.',
			moreResults: 'Đây là thêm kết quả tìm kiếm:',
			paginationStatus: 'Trang {{current}}/{{total}} (tổng {{count}} kết quả)',
			noMorePages: 'Đây là trang cuối cùng của kết quả.',
			searchingFor: 'Đang tìm kiếm "{{searchTerm}}"',
			searchingForTags: 'Đang tìm kiếm các tag: {{tags}}',
			showingPage: 'Trang {{page}} của {{total}}',
		},
		// Close command messages
		close: {
			instruction: 'Để đóng cuộc hội thoại này, sử dụng lệnh /close trong ghi chú của bạn.',
			completed: 'Cuộc hội thoại đã được đóng.',
		},
		// Confirmation messages
		confirmation: {
			notUnderstood: "Tôi không hiểu phản hồi của bạn. Vui lòng trả lời 'có' hoặc 'không'.",
			noPending: 'Không có yêu cầu xác nhận nào đang chờ phản hồi.',
			operationCancelled: 'Thao tác đã bị hủy bỏ.',
			errorProcessing: 'Lỗi khi xử lý xác nhận: {{errorMessage}}',
		},
		// UI elements
		ui: {
			openStewardChat: 'Mở Trò Chuyện Steward (Ctrl+Shift+L)',
			buildingSearchIndex: 'Đang xây dựng chỉ mục tìm kiếm...',
			errorBuildingSearchIndex:
				'Lỗi khi xây dựng chỉ mục tìm kiếm. Kiểm tra bảng điều khiển để biết chi tiết.',
			buildingIndexes: 'Steward: Đang xây dựng chỉ mục...',
			noActiveEditor:
				'Không có trình soạn thảo nào đang hoạt động để đóng cuộc trò chuyện: {{conversationTitle}}',
			conversationLinkNotFound: 'Không thể tìm thấy liên kết trò chuyện cho {{conversationTitle}}',
			errorClosingConversation: 'Lỗi khi đóng cuộc trò chuyện: {{errorMessage}}',
			errorCreatingNote: 'Lỗi khi tạo ghi chú trò chuyện: {{errorMessage}}',
			noteNotFound: 'Không tìm thấy ghi chú trò chuyện: {{notePath}}',
			errorUpdatingConversation: 'Lỗi khi cập nhật cuộc trò chuyện: {{errorMessage}}',
			searchIndexNotFound: 'Không tìm thấy chỉ mục tìm kiếm. Sẽ xây dựng chỉ mục ngay...',
			errorBuildingInitialIndexes:
				'Steward: Lỗi khi xây dựng chỉ mục ban đầu. Kiểm tra bảng điều khiển để biết chi tiết.',
			decryptionError: 'Không thể giải mã khóa API. Vui lòng nhập lại trong cài đặt.',
			encryptionError: 'Không thể mã hóa khóa API. Vui lòng thử lại.',
			welcomeMessage:
				'Chào mừng đến với trò chuyện Steward luôn sẵn sàng. Gõ bên dưới để tương tác.',
			commandPlaceholder: 'Nhấn Enter để gửi',
		},
		read: {
			noContentFound: 'Không tìm thấy nội dung như vậy trong trình soạn thảo.',
		},
		// Conversation states
		conversation: {
			workingOnIt: 'Đang xử lý...',
			generating: 'Đang tạo...',
			generatingImage: 'Đang tạo hình ảnh...',
			generatingAudio: 'Đang tạo âm thanh...',
			moving: 'Đang di chuyển...',
			searching: 'Đang tìm kiếm...',
			calculating: 'Đang tính toán...',
			reverting: 'Đang hoàn tác thay đổi...',
			revertSuccess: 'Đã hoàn tác thay đổi cuối cùng thành công.',
			revertFailed: 'Không thể hoàn tác thay đổi. Không có thay đổi nào trước đó để hoàn tác.',
			copying: 'Đang sao chép...',
			deleting: 'Đang xóa...',
			updating: 'Đang cập nhật...',
			creatingPrompt: 'Đang tạo gợi ý tùy chỉnh...',
			creating: 'Đang tạo...',
			readingContent: 'Đang đọc nội dung...',
		},
	},
};

export default vi;
