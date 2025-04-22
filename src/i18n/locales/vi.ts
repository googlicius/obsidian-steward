const vi = {
	translation: {
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
			noFilesFound:
				'Tôi không tìm thấy tập tin nào phù hợp với truy vấn của bạn. Vui lòng thử từ khóa tìm kiếm khác.',
			createFoldersHeader: 'Tôi cần tạo các thư mục sau trước khi di chuyển tập tin:',
			createFoldersQuestion: 'Bạn có muốn tôi tạo các thư mục này không?',
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
			commandPlaceholder: 'Nhấn Shift+Enter để gửi',
		},
		// Conversation states
		conversation: {
			workingOnIt: 'Đang xử lý...',
			generating: 'Đang tạo...',
			moving: 'Đang di chuyển...',
			searching: 'Đang tìm kiếm...',
			calculating: 'Đang tính toán...',
		},
	},
};

export default vi;
