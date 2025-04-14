import { SearchIndexer } from './searchIndexer';

// Mock Obsidian modules
jest.mock(
	'obsidian',
	() => ({
		App: class App {},
		TFile: class TFile {},
	}),
	{ virtual: true }
);

// Mock the dependencies
jest.mock('./stopwords', () => ({
	removeStopwords: jest.fn(words => words), // Pass through words for testing
}));

// Mock COMMAND_PREFIXES
jest.mock('./main', () => ({
	COMMAND_PREFIXES: ['/command', '/exec', '/run'],
}));

jest.mock('./database/PluginDatabase', () => {
	return {
		PluginDatabase: jest.fn().mockImplementation(() => ({
			transaction: jest.fn(),
			documents: {
				put: jest.fn(),
				delete: jest.fn(),
				where: jest.fn().mockReturnThis(),
				anyOf: jest.fn().mockReturnThis(),
				limit: jest.fn().mockReturnThis(),
				first: jest.fn(),
			},
			terms: {
				bulkAdd: jest.fn(),
				where: jest.fn().mockReturnThis(),
				equals: jest.fn().mockReturnThis(),
				delete: jest.fn(),
				toArray: jest.fn(),
			},
		})),
	};
});

// Mock Obsidian's App
const mockApp = {
	vault: {
		on: jest.fn(),
		read: jest.fn(),
		getAbstractFileByPath: jest.fn(),
		getMarkdownFiles: jest.fn().mockReturnValue([]),
	},
	metadataCache: {
		getFileCache: jest.fn().mockReturnValue({}),
	},
};

// Create a helper to expose the private tokenizeContent method for testing
class TestableSearchIndexer extends SearchIndexer {
	public exposedTokenizeContent(content: string) {
		return this['tokenizeContent'](content);
	}
}

describe('SearchIndexer', () => {
	let searchIndexer: TestableSearchIndexer;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Create a new instance for each test
		searchIndexer = new TestableSearchIndexer({
			app: mockApp as any,
			dbName: 'test-db',
			conversationFolder: 'test-folder',
		});
	});

	describe('tokenizeContent', () => {
		it('should correctly tokenize English text', () => {
			const content = 'This is a sample text for testing';
			const result = searchIndexer.exposedTokenizeContent(content);

			// Since we mocked removeStopwords to pass through all words
			expect(result).toEqual([
				{ term: 'this', count: 1, positions: [0] },
				{ term: 'is', count: 1, positions: [1] },
				{ term: 'a', count: 1, positions: [2] },
				{ term: 'sample', count: 1, positions: [3] },
				{ term: 'text', count: 1, positions: [4] },
				{ term: 'for', count: 1, positions: [5] },
				{ term: 'testing', count: 1, positions: [6] },
			]);
		});

		it('should preserve contractions', () => {
			const content = "I'm not going to break the don't and won't contractions";
			const result = searchIndexer.exposedTokenizeContent(content);

			// Check if contractions remain intact
			const terms = result.map(t => t.term);
			expect(terms).toContain("i'm");
			expect(terms).toContain("don't");
			expect(terms).toContain("won't");
			expect(terms).not.toContain('don');
			expect(terms).not.toContain('won');
		});

		it('should handle Unicode characters for non-English languages', () => {
			// Vietnamese text with diacritical marks
			const content = 'Tiếng Việt có nhiều dấu và ký tự đặc biệt';
			const result = searchIndexer.exposedTokenizeContent(content);

			const terms = result.map(t => t.term);
			expect(terms).toContain('tiếng');
			expect(terms).toContain('việt');
			expect(terms).toContain('có');
			expect(terms).toContain('nhiều');
			expect(terms).toContain('dấu');
			expect(terms).toContain('và');
			expect(terms).toContain('ký');
			expect(terms).toContain('tự');
			expect(terms).toContain('đặc');
			expect(terms).toContain('biệt');
		});

		it('should handle mixed English and non-English with special characters', () => {
			const content = 'Mix of English and Tiếng Việt with numbers 123 and symbols @#$%';
			const result = searchIndexer.exposedTokenizeContent(content);

			const terms = result.map(t => t.term);
			expect(terms).toContain('mix');
			expect(terms).toContain('of');
			expect(terms).toContain('english');
			expect(terms).toContain('and');
			expect(terms).toContain('tiếng');
			expect(terms).toContain('việt');
			expect(terms).toContain('with');
			expect(terms).toContain('numbers');
			expect(terms).toContain('123');
			expect(terms).toContain('symbols');
			// Symbols should be removed except # which is preserved for tags
			expect(terms).not.toContain('@');
			expect(terms).toContain('#');
			expect(terms).not.toContain('$');
			expect(terms).not.toContain('%');
		});

		it('should preserve hashtags', () => {
			const content = 'Text with #hashtags and #multiple-tags';
			const result = searchIndexer.exposedTokenizeContent(content);

			const terms = result.map(t => t.term);
			expect(terms).toContain('#hashtags');
			expect(terms).toContain('#multiple-tags');
		});
	});
});
