import { ConfirmationEventHandler } from './ConfirmationEventHandler';

// Mock dependencies
jest.mock('./EventEmitter', () => ({
	eventEmitter: {
		on: jest.fn(),
		emit: jest.fn(),
	},
	Events: {
		CONFIRMATION_RESPONDED: 'CONFIRMATION_RESPONDED',
		CONFIRMATION_REQUESTED: 'CONFIRMATION_REQUESTED',
	},
}));

// Mock getObsidianLanguage to fix localStorage not defined error
jest.mock('../utils/getObsidianLanguage', () => ({
	getObsidianLanguage: jest.fn().mockReturnValue('en'),
}));

// Mock i18n module
jest.mock('../i18n', () => ({
	getTranslation: jest.fn().mockImplementation(() => {
		return (key: string) => `translated_${key}`;
	}),
	__esModule: true,
	default: {
		t: jest.fn().mockImplementation((key: string) => `translated_${key}`),
		language: 'en',
		changeLanguage: jest.fn(),
	},
}));

// Mock StewardPlugin
const mockPlugin = {
	updateConversationNote: jest.fn(),
} as any;

describe('ConfirmationEventHandler', () => {
	let confirmationEventHandler: ConfirmationEventHandler;

	beforeEach(() => {
		jest.clearAllMocks();
		confirmationEventHandler = new ConfirmationEventHandler(mockPlugin);
	});

	describe('isConfirmIntent', () => {
		// Test empty input
		it('should treat empty string as an affirmative confirmation', () => {
			const result = confirmationEventHandler.isConfirmIntent('');

			expect(result).not.toBeNull();
			expect(result).toEqual({
				isConfirmation: true,
				isAffirmative: true,
			});
		});

		// Test affirmative responses
		it.each([
			'yes',
			'y',
			'Yes',
			'YES',
			'sure',
			'Sure',
			'ok',
			'OK',
			'yeah',
			'yep',
			'create',
			'confirm',
			'proceed',
		])('should correctly identify affirmative response: "%s"', input => {
			const result = confirmationEventHandler.isConfirmIntent(input);

			expect(result).not.toBeNull();
			expect(result).toEqual({
				isConfirmation: true,
				isAffirmative: true,
			});
		});

		// Test negative responses
		it.each(['no', 'n', 'No', 'NO', 'nope', "don't", 'dont', 'cancel', 'stop'])(
			'should correctly identify negative response: "%s"',
			input => {
				const result = confirmationEventHandler.isConfirmIntent(input);

				expect(result).not.toBeNull();
				expect(result).toEqual({
					isConfirmation: true,
					isAffirmative: false,
				});
			}
		);

		// Test Vietnamese affirmative responses
		it.each(['có', 'có nha', 'đồng ý', 'vâng', 'ừ', 'tạo', 'tiếp tục'])(
			'should correctly identify Vietnamese affirmative response: "%s"',
			input => {
				const result = confirmationEventHandler.isConfirmIntent(input);

				expect(result).not.toBeNull();
				expect(result).toEqual({
					isConfirmation: true,
					isAffirmative: true,
				});
			}
		);

		// Test Vietnamese negative responses
		it.each(['không', 'không nha', 'đừng', 'hủy', 'dừng lại'])(
			'should correctly identify Vietnamese negative response: "%s"',
			input => {
				const result = confirmationEventHandler.isConfirmIntent(input);

				expect(result).not.toBeNull();
				expect(result).toEqual({
					isConfirmation: true,
					isAffirmative: false,
				});
			}
		);

		// Test unclear or invalid responses
		it.each([
			'maybe',
			"I'm not sure",
			'what do you think?',
			'possibly',
			'let me think about it',
			'hmm',
			'123',
			'hello there',
			'chưa chắc', // Vietnamese for "not sure"
			'để tôi suy nghĩ', // Vietnamese for "let me think"
		])('should return null for unclear responses: "%s"', input => {
			const result = confirmationEventHandler.isConfirmIntent(input);
			expect(result).toBeNull();
		});

		// Test with extra whitespace
		it('should handle extra whitespace', () => {
			expect(confirmationEventHandler.isConfirmIntent('  yes  ')).toEqual({
				isConfirmation: true,
				isAffirmative: true,
			});

			expect(confirmationEventHandler.isConfirmIntent('  no  ')).toEqual({
				isConfirmation: true,
				isAffirmative: false,
			});

			expect(confirmationEventHandler.isConfirmIntent('  có  ')).toEqual({
				isConfirmation: true,
				isAffirmative: true,
			});
		});

		// Test with case variations
		it('should be case insensitive', () => {
			expect(confirmationEventHandler.isConfirmIntent('YES')).toEqual({
				isConfirmation: true,
				isAffirmative: true,
			});

			expect(confirmationEventHandler.isConfirmIntent('No')).toEqual({
				isConfirmation: true,
				isAffirmative: false,
			});

			expect(confirmationEventHandler.isConfirmIntent('CÓ')).toEqual({
				isConfirmation: true,
				isAffirmative: true,
			});
		});

		// Test with phrases that contain confirmation words
		it('should not match phrases that contain but are not exactly confirmation words', () => {
			expect(confirmationEventHandler.isConfirmIntent('yes I would like to')).toBeNull();
			expect(confirmationEventHandler.isConfirmIntent('no way')).toBeNull();
			expect(confirmationEventHandler.isConfirmIntent('surely')).toBeNull(); // not exactly "sure"
			expect(confirmationEventHandler.isConfirmIntent('okay then')).toBeNull(); // not exactly "ok"
		});
	});
});
