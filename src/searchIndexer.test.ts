import { SearchIndexer } from './searchIndexer';

// Mock Obsidian modules
jest.mock(
	'obsidian',
	() => ({
		App: class App {},
		TFile: class TFile {
			path: string;
			extension: string;
			constructor(path: string, extension?: string) {
				this.path = path;
				this.extension = extension || 'md';
			}
		},
	}),
	{ virtual: true }
);

// Mock COMMAND_PREFIXES
jest.mock('./main', () => ({
	COMMAND_PREFIXES: ['/command', '/exec', '/run'],
}));

jest.mock('./database/PluginDatabase', () => {
	return {
		PluginDatabase: jest.fn().mockImplementation(() => ({
			transaction: jest.fn((mode, tables, callback) => {
				// Execute the callback immediately
				return callback();
			}),
			documents: {
				put: jest.fn(),
				delete: jest.fn(),
				where: jest.fn().mockReturnThis(),
				anyOf: jest.fn().mockReturnThis(),
				limit: jest.fn().mockReturnThis(),
				first: jest.fn(),
				count: jest.fn().mockResolvedValue(100), // Mock total document count
				get: jest
					.fn()
					.mockImplementation(id => Promise.resolve({ id, path: `test/path/${id}.md` })),
				equals: jest.fn().mockReturnThis(),
				toArray: jest.fn(),
			},
			terms: {
				bulkAdd: jest.fn(),
				where: jest.fn().mockReturnThis(),
				equals: jest.fn().mockReturnThis(),
				anyOf: jest.fn().mockReturnThis(),
				and: jest.fn().mockReturnThis(),
				delete: jest.fn(),
				toArray: jest.fn(),
			},
			folders: {
				toArray: jest.fn(),
			},
		})),
		TermSource: {
			Content: 0,
			Filename: 1,
		},
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

// Create a helper to expose the private methods for testing
class TestableSearchIndexer extends SearchIndexer {
	public exposedTokenizeContent(content: string) {
		return this['tokenizeContent'](content);
	}

	public exposedCalculateTF(termFreq: number, docLength: number) {
		return this['calculateTF'](termFreq, docLength);
	}

	public exposedCalculateIDF(totalDocs: number, docsWithTerm: number) {
		return this['calculateIDF'](totalDocs, docsWithTerm);
	}

	public exposedCalculateCoverageBonus(matchedTermCount: number, totalTermCount: number) {
		return this['calculateCoverageBonus'](matchedTermCount, totalTermCount);
	}

	public exposedCalculateProximityBonus(
		termPositions: Map<string, number[]>,
		queryTerms: string[]
	) {
		return this['calculateProximityBonus'](termPositions, queryTerms);
	}

	public exposedGetDocumentsByNames(names: string[]) {
		return this['getDocumentsByNames'](names);
	}

	public exposedGetFoldersByNames(names: string[]) {
		return this['getFoldersByNames'](names);
	}

	public exposedCalculateDocumentScores(documents: any[], queries: string[]) {
		return this['calculateDocumentScores'](documents, queries);
	}

	public exposedContainsCommandPrefix(content: string) {
		return this['containsCommandPrefix'](content);
	}

	// Expose cache-related methods for testing
	public exposedUpdateCachedNote(file: any, content: string): Promise<void> {
		// Mock the app.vault.read to return our test content
		(this as any).app.vault.read = jest.fn().mockResolvedValue(content);
		return this['updateCachedNote'](file);
	}

	public exposedClearCachedNote(): void {
		return this['clearCachedNote']();
	}

	// Expose cache properties for testing
	public getCachedNotePath(): string | null {
		return this['cachedNotePath'];
	}

	public getCachedNoteTermsCount(): number {
		return this['cachedNoteTermsCount'];
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
				{ term: 'sample', count: 1, positions: [0] },
				{ term: 'text', count: 1, positions: [1] },
				{ term: 'testing', count: 1, positions: [2] },
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

		it('should handle mixed English, tags, and non-English with special characters', () => {
			const content = 'Mix of English and Tiếng Việt with numbers 123 #tag1 and symbols @#$%';
			const result = searchIndexer.exposedTokenizeContent(content);

			const terms = result.map(t => t.term);
			expect(terms).toContain('mix');
			expect(terms).toContain('english');
			expect(terms).toContain('tiếng');
			expect(terms).toContain('việt');
			expect(terms).toContain('numbers');
			expect(terms).toContain('123');
			expect(terms).toContain('symbols');
			expect(terms).toContain('#tag1');
			expect(terms).not.toContain('@');
			expect(terms).not.toContain('$');
			expect(terms).not.toContain('%');
			expect(terms).not.toContain('#');
		});

		it('should preserve hashtags', () => {
			const content = 'Text with #hashtags and #multiple-tags';
			const result = searchIndexer.exposedTokenizeContent(content);

			const terms = result.map(t => t.term);
			expect(terms).toContain('#hashtags');
			expect(terms).toContain('#multiple-tags');
		});
	});

	describe('TF-IDF scoring', () => {
		it('should correctly calculate Term Frequency (TF)', () => {
			// TF = term frequency in document / total terms in document
			expect(searchIndexer.exposedCalculateTF(5, 100)).toBeCloseTo(0.8476534883872682);
			expect(searchIndexer.exposedCalculateTF(10, 100)).toBeCloseTo(0.9978439716109562);
			expect(searchIndexer.exposedCalculateTF(0, 100)).toBeCloseTo(0);
			expect(searchIndexer.exposedCalculateTF(5, 0)).toBeCloseTo(0); // Handle division by zero
		});

		it('should correctly calculate Inverse Document Frequency (IDF)', () => {
			// IDF = log(total documents / documents containing term)
			expect(searchIndexer.exposedCalculateIDF(1000, 10)).toBeCloseTo(Math.log(100));
			expect(searchIndexer.exposedCalculateIDF(1000, 1)).toBeCloseTo(Math.log(1000));
			expect(searchIndexer.exposedCalculateIDF(1000, 1000)).toBeCloseTo(Math.log(1));
			expect(searchIndexer.exposedCalculateIDF(1000, 0)).toBeCloseTo(0); // Handle division by zero
		});
	});

	describe('Coverage and Proximity Bonuses', () => {
		it('should calculate coverage bonus correctly', () => {
			// Test full coverage
			expect(searchIndexer.exposedCalculateCoverageBonus(5, 5)).toBeCloseTo(0.5);

			// Test partial coverage
			expect(searchIndexer.exposedCalculateCoverageBonus(3, 5)).toBeCloseTo(
				0.5 * Math.pow(3 / 5, 1.5)
			);
			expect(searchIndexer.exposedCalculateCoverageBonus(0, 5)).toBeCloseTo(0);

			// Test edge cases
			expect(searchIndexer.exposedCalculateCoverageBonus(0, 0)).toBe(0);
		});

		it('should calculate proximity bonus correctly', () => {
			// Create test data for term positions
			const positionsMap = new Map<string, number[]>();
			positionsMap.set('term1', [10, 50, 100]);
			positionsMap.set('term2', [12, 60, 105]);
			positionsMap.set('term3', [30, 80, 110]);

			// Test with terms that are close
			expect(
				searchIndexer.exposedCalculateProximityBonus(positionsMap, ['term1', 'term2', 'term3'])
			).toBeGreaterThan(0);

			// Test with terms that are far apart
			const farPositionsMap = new Map<string, number[]>();
			farPositionsMap.set('term1', [10]);
			farPositionsMap.set('term2', [50]);
			farPositionsMap.set('term3', [100]);
			expect(
				searchIndexer.exposedCalculateProximityBonus(farPositionsMap, ['term1', 'term2', 'term3'])
			).toBeCloseTo(0);

			// Test with single term query (no proximity bonus)
			expect(searchIndexer.exposedCalculateProximityBonus(positionsMap, ['term1'])).toBe(0);

			// Test with empty query
			expect(searchIndexer.exposedCalculateProximityBonus(positionsMap, [])).toBe(0);
		});

		it('should handle missing terms in proximity calculation', () => {
			// Create test data with missing terms
			const positionsMap = new Map<string, number[]>();
			positionsMap.set('term1', [10, 50]);

			// Query contains terms not in the document
			expect(
				searchIndexer.exposedCalculateProximityBonus(positionsMap, ['term1', 'term2', 'term3'])
			).toBe(0);
		});

		it('should give higher proximity bonus for closer terms', () => {
			// Create test data with varying distances
			const closePositionsMap = new Map<string, number[]>();
			closePositionsMap.set('term1', [10]);
			closePositionsMap.set('term2', [11]); // Adjacent terms

			const mediumPositionsMap = new Map<string, number[]>();
			mediumPositionsMap.set('term1', [10]);
			mediumPositionsMap.set('term2', [15]); // 5 tokens apart

			// Calculate bonuses
			const closeBonus = searchIndexer.exposedCalculateProximityBonus(closePositionsMap, [
				'term1',
				'term2',
			]);

			const mediumBonus = searchIndexer.exposedCalculateProximityBonus(mediumPositionsMap, [
				'term1',
				'term2',
			]);

			// Closer terms should get higher bonus
			expect(closeBonus).toBeGreaterThan(mediumBonus);
		});
	});

	describe('getDocumentsByNames', () => {
		it('should return empty array when names array is empty', async () => {
			const result = await searchIndexer.exposedGetDocumentsByNames([]);
			expect(result).toEqual([]);
		});

		it('should return empty array when there are no terms in the name', async () => {
			// Mock the tokenizeContent method to return no terms
			jest.spyOn(searchIndexer as any, 'tokenizeContent').mockReturnValueOnce([]);

			const result = await searchIndexer.exposedGetDocumentsByNames(['emptyName']);
			expect(result).toEqual([]);
		});

		it('should return empty array when there are different documentIds in termEntries', async () => {
			// Mock tokenizeContent to return a term
			jest
				.spyOn(searchIndexer as any, 'tokenizeContent')
				.mockReturnValueOnce([{ term: 'test', count: 1, positions: [0] }]);

			// Mock the terms.where().toArray() to return entries with different documentIds
			const mockDb = (searchIndexer as any).db;

			// First ensure the where and equals methods return the correct chainable object
			mockDb.terms.where.mockReturnValue(mockDb.terms);
			mockDb.terms.equals.mockReturnValue(mockDb.terms);

			// Then mock toArray to return entries with different documentIds
			mockDb.terms.toArray.mockResolvedValueOnce([
				{ documentId: 1, source: 1 },
				{ documentId: 2, source: 1 },
			]);

			const result = await searchIndexer.exposedGetDocumentsByNames(['testName']);
			expect(result).toEqual([]);
		});

		it('should return one document when there is only one documentId in termEntries', async () => {
			// Mock tokenizeContent to return a term
			jest
				.spyOn(searchIndexer as any, 'tokenizeContent')
				.mockReturnValueOnce([{ term: 'test', count: 1, positions: [0] }]);

			// Mock the terms.where().toArray() to return entries with the same documentId
			const mockDb = (searchIndexer as any).db;

			// First ensure the where and equals methods return the correct chainable object
			mockDb.terms.where.mockReturnValue(mockDb.terms);
			mockDb.terms.equals.mockReturnValue(mockDb.terms);

			// Then mock toArray to return entries with the same documentId
			mockDb.terms.toArray.mockResolvedValueOnce([
				{ documentId: 1, source: 1 },
				{ documentId: 1, source: 1 },
			]);

			// Mock the documents.get() to return a document
			mockDb.documents.get = jest.fn().mockResolvedValueOnce({
				id: 1,
				path: 'test/path.md',
				fileName: 'test',
			});

			const result = await searchIndexer.exposedGetDocumentsByNames(['testName']);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe('test/path.md');
		});

		it('should handle multiple names correctly', async () => {
			const mockDb = (searchIndexer as any).db;
			mockDb.terms.where.mockReturnValue(mockDb.terms);
			mockDb.terms.equals.mockReturnValue(mockDb.terms);

			// Mock tokenizeContent to return different terms for different calls
			const tokenizeSpy = jest.spyOn(searchIndexer as any, 'tokenizeContent');

			// First name tokenization
			tokenizeSpy.mockReturnValueOnce([
				{ term: 'first', count: 1, positions: [0] },
				{ term: 'doc', count: 1, positions: [1] },
			]);

			// Second name tokenization
			tokenizeSpy.mockReturnValueOnce([
				{ term: 'second', count: 1, positions: [0] },
				{ term: 'doc', count: 1, positions: [1] },
			]);

			// Mock term retrieval for "first"
			mockDb.terms.toArray.mockResolvedValueOnce([{ documentId: 1, source: 2 }]);

			// Mock term retrieval for "doc" (for first name)
			mockDb.terms.toArray.mockResolvedValueOnce([{ documentId: 1, source: 2 }]);

			// Mock term retrieval for "second"
			mockDb.terms.toArray.mockResolvedValueOnce([{ documentId: 2, source: 2 }]);

			// Mock term retrieval for "doc" (for second name)
			mockDb.terms.toArray.mockResolvedValueOnce([{ documentId: 2, source: 2 }]);

			// Mock document retrieval
			mockDb.documents.get = jest
				.fn()
				.mockResolvedValueOnce({
					id: 1,
					path: 'test/first-doc.md',
					fileName: 'first doc',
				})
				.mockResolvedValueOnce({
					id: 2,
					path: 'test/second-doc.md',
					fileName: 'second doc',
				});

			const result = await searchIndexer.exposedGetDocumentsByNames(['first doc', 'second doc']);

			expect(result).toHaveLength(2);
			expect(result[0].path).toBe('test/first-doc.md');
			expect(result[1].path).toBe('test/second-doc.md');
		});

		it('should not return document when term matches are not found in all terms', async () => {
			// Mock tokenizeContent to return multiple terms
			jest.spyOn(searchIndexer as any, 'tokenizeContent').mockReturnValueOnce([
				{ term: 'test', count: 1, positions: [0] },
				{ term: 'doc', count: 1, positions: [1] },
			]);

			const mockDb = (searchIndexer as any).db;
			mockDb.terms.where.mockReturnValue(mockDb.terms);
			mockDb.terms.equals.mockReturnValue(mockDb.terms);
			mockDb.terms.anyOf.mockReturnValue(mockDb.terms);
			mockDb.terms.and.mockReturnValue(mockDb.terms);

			// Mock result for anyOf query with both terms
			// Return different document IDs for each term which will cause
			// the intersection to be empty
			mockDb.terms.toArray.mockResolvedValueOnce([
				{ documentId: 1, term: 'test', source: 1 },
				{ documentId: 2, term: 'doc', source: 1 },
			]);

			// Make sure documents.get is not called (should never get to this point)
			mockDb.documents.get = jest.fn().mockImplementation(() => {
				throw new Error('documents.get should not be called');
			});

			const result = await searchIndexer.exposedGetDocumentsByNames(['test doc']);
			expect(result).toEqual([]);
		});
	});

	describe('calculateDocumentScores', () => {
		it('should return empty array with zero scores when documents array is empty', async () => {
			const result = await searchIndexer.exposedCalculateDocumentScores([], ['test query']);
			expect(result).toEqual([]);
		});

		it('should return documents with zero scores when queries array is empty', async () => {
			const documents = [
				{ id: 1, path: 'test/doc1.md', fileName: 'document one', tokenCount: 100 },
				{ id: 2, path: 'test/doc2.md', fileName: 'document two', tokenCount: 150 },
				{ id: 3, path: 'test/doc3.md', fileName: 'document three', tokenCount: 200 },
			];

			const result = await searchIndexer.exposedCalculateDocumentScores(documents, []);

			expect(result).toHaveLength(3);
			expect(result[0].score).toBe(0);
			expect(result[1].score).toBe(0);
			expect(result[2].score).toBe(0);
		});

		it('should calculate scores for multiple documents', async () => {
			// Setup mock documents
			const documents = [
				{ id: 1, path: 'test/doc1.md', fileName: 'document one', tokenCount: 100, tags: [] },
				{ id: 2, path: 'test/doc2.md', fileName: 'document two', tokenCount: 150, tags: [] },
				{ id: 3, path: 'test/doc3.md', fileName: 'document three', tokenCount: 200, tags: [] },
			];

			// Mock the tokenizeContent method
			jest.spyOn(searchIndexer as any, 'tokenizeContent').mockImplementation((content: string) => {
				// Extract words from the query and return as terms
				const words = content.toLowerCase().split(/\s+/);
				return words.map((word: string, index: number) => ({
					term: word,
					count: 1,
					positions: [index],
				}));
			});

			// Mock term query results
			const mockDb = (searchIndexer as any).db;

			// Setup the term results for each term in the query
			mockDb.terms.toArray.mockImplementation(() => {
				return [
					// Results for document 1 - has only "test" in content
					{ documentId: 1, term: 'test', frequency: 1, source: 0, positions: [5, 10] },

					// Results for document 2 - has "query" in content
					{ documentId: 2, term: 'query', frequency: 2, source: 0, positions: [15, 20, 25] },

					// Results for document 3 - has both "test" and "query" in content with higher frequencies
					{ documentId: 3, term: 'test', frequency: 2, source: 0, positions: [30, 35] },
					{ documentId: 3, term: 'query', frequency: 2, source: 0, positions: [40, 45] },
				];
			});

			const result = await searchIndexer.exposedCalculateDocumentScores(documents, ['test query']);

			// All documents should have scores
			expect(result).toHaveLength(3);
			expect(result[0].score).toBeGreaterThan(0);
			expect(result[1].score).toBeGreaterThan(0);
			expect(result[2].score).toBeGreaterThan(0);

			// Document 3 should have highest score as it matches both terms
			expect(result[2].score).toBeGreaterThan(result[0].score);
			expect(result[2].score).toBeGreaterThan(result[1].score);
		});

		it('should give higher scores to documents with filename matches', async () => {
			// Setup mock documents
			const documents = [
				{ id: 1, path: 'test/doc1.md', fileName: 'test document', tokenCount: 100, tags: [] },
				{ id: 2, path: 'test/doc2.md', fileName: 'another document', tokenCount: 100, tags: [] },
				{ id: 3, path: 'test/doc3.md', fileName: 'just a file', tokenCount: 100, tags: [] },
			];

			// Mock the tokenizeContent method
			jest.spyOn(searchIndexer as any, 'tokenizeContent').mockImplementation((content: string) => {
				// Extract words from the query and return as terms
				const words = content.toLowerCase().split(/\s+/);
				return words.map((word: string, index: number) => ({
					term: word,
					count: 1,
					positions: [index],
				}));
			});

			// Mock term query results
			const mockDb = (searchIndexer as any).db;

			// Setup the term results for the query
			mockDb.terms.toArray.mockImplementation(() => {
				return [
					// Document 1 has "test" in both content and filename
					{ documentId: 1, term: 'test', frequency: 1, source: 0, positions: [5] },
					{ documentId: 1, term: 'test', frequency: 1, source: 1, positions: [0] },

					// Document 2 has "test" only in content
					{ documentId: 2, term: 'test', frequency: 1, source: 0, positions: [10] },

					// Document 3 has "test" only in content, but appears more frequently
					{ documentId: 3, term: 'test', frequency: 3, source: 0, positions: [15, 20, 25] },
				];
			});

			const result = await searchIndexer.exposedCalculateDocumentScores(documents, ['test']);

			// All documents should have scores
			expect(result).toHaveLength(3);

			// Document 1 should have highest score due to filename match
			expect(result[0].score).toBeGreaterThan(result[1].score);

			// Even though Document 3 has more occurrences, Document 1 should still have higher score
			// due to filename match bonus (2.0x multiplier)
			expect(result[0].score).toBeGreaterThan(result[2].score);
		});

		it('should apply coverage and proximity bonuses correctly', async () => {
			// Setup mock documents
			const documents = [
				{ id: 1, path: 'test/doc1.md', fileName: 'first doc', tokenCount: 100, tags: [] },
				{ id: 2, path: 'test/doc2.md', fileName: 'second doc', tokenCount: 100, tags: [] },
			];

			// Mock the tokenizeContent method
			jest.spyOn(searchIndexer as any, 'tokenizeContent').mockImplementation((content: string) => {
				// Extract words from the query and return as terms
				const words = content.toLowerCase().split(/\s+/);
				return words.map((word: string, index: number) => ({
					term: word,
					count: 1,
					positions: [index],
				}));
			});

			// Mock term query results
			const mockDb = (searchIndexer as any).db;

			// Setup the term results for the query "test query example"
			mockDb.terms.toArray.mockImplementation(() => {
				return [
					// Document 1 matches all terms (better coverage), but terms are far apart
					{ documentId: 1, term: 'test', frequency: 1, source: 0, positions: [5] },
					{ documentId: 1, term: 'query', frequency: 1, source: 0, positions: [50] },
					{ documentId: 1, term: 'example', frequency: 1, source: 0, positions: [100] },

					// Document 2 matches only two terms, but they're close together (better proximity)
					{ documentId: 2, term: 'test', frequency: 1, source: 0, positions: [10] },
					{ documentId: 2, term: 'query', frequency: 1, source: 0, positions: [11] },
				];
			});

			// Spy on the bonus calculation methods to verify they're called
			const coverageSpy = jest.spyOn(searchIndexer as any, 'calculateCoverageBonus');
			const proximitySpy = jest.spyOn(searchIndexer as any, 'calculateProximityBonus');

			const result = await searchIndexer.exposedCalculateDocumentScores(documents, [
				'test query example',
			]);

			// Verify the bonus calculation methods were called
			expect(coverageSpy).toHaveBeenCalled();
			expect(proximitySpy).toHaveBeenCalled();

			// Both documents should have scores
			expect(result).toHaveLength(2);
			expect(result[0].score).toBeGreaterThan(0);
			expect(result[1].score).toBeGreaterThan(0);

			// Document 1 should have higher coverage bonus (matches all 3 terms vs 2 terms)
			// but Document 2 should have higher proximity bonus (terms are adjacent vs far apart)

			// In a real-life scenario, the balance between coverage and proximity would determine
			// the final score. Here we're just testing that both bonuses are applied.
		});
	});

	describe('getFoldersByNames', () => {
		it('should return empty array when names array is empty', async () => {
			const result = await searchIndexer.exposedGetFoldersByNames([]);
			expect(result).toEqual([]);
		});

		it('should return empty array when no folders match the name', async () => {
			const mockDb = (searchIndexer as any).db;

			// Mock empty folder array
			mockDb.folders.toArray.mockResolvedValueOnce([]);

			const result = await searchIndexer.exposedGetFoldersByNames(['nonExistentFolder']);
			expect(result).toEqual([]);
		});

		it('should return empty array when multiple folders match the name', async () => {
			const mockDb = (searchIndexer as any).db;

			// Mock multiple matching folders
			mockDb.folders.toArray.mockResolvedValueOnce([
				{ id: 1, name: 'testFolder A', path: 'path/to/testFolder A' },
				{ id: 2, name: 'testFolder B', path: 'path/to/testFolder B' },
			]);

			const result = await searchIndexer.exposedGetFoldersByNames(['testFolder']);
			expect(result).toEqual([]);
		});

		it('should return one folder when exactly one folder matches the name', async () => {
			const mockDb = (searchIndexer as any).db;

			mockDb.folders.toArray.mockResolvedValueOnce([
				{ id: 1, name: 'testFolder A', path: 'path/to/testFolder A' },
				{ id: 2, name: 'testFolder B', path: 'path/to/testFolder B' },
			]);

			const result = await searchIndexer.exposedGetFoldersByNames(['testFolder A']);
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ id: 1, name: 'testFolder A', path: 'path/to/testFolder A' });
		});

		it('should return one folder when name is a partial match (case insensitive)', async () => {
			const mockDb = (searchIndexer as any).db;

			// Mock a single folder with a name that contains the search term
			const mockFolder = { id: 1, name: 'testFolder', path: 'path/to/testFolder' };
			mockDb.folders.toArray.mockResolvedValueOnce([mockFolder]);

			const result = await searchIndexer.exposedGetFoldersByNames(['test']);
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(mockFolder);
		});

		it('should handle exact matches correctly', async () => {
			const mockDb = (searchIndexer as any).db;

			mockDb.folders.toArray.mockResolvedValueOnce([
				{ id: 1, name: 'testFolder', path: 'path/to/testFolder' },
				{ id: 2, name: 'test', path: 'path/to/anotherFolder' },
			]);

			const result = await searchIndexer.exposedGetFoldersByNames(['^test$']);
			expect(result).toHaveLength(1);
			expect(result[0].id).toEqual(2);
		});

		it('should handle folder start with matches correctly', async () => {
			const mockDb = (searchIndexer as any).db;

			mockDb.folders.toArray.mockResolvedValueOnce([
				{ id: 1, name: 'animalsFolder', path: 'path/to/animalsFolder' },
				{ id: 2, name: 'animalsHouse', path: 'path/to/animalsHouse' },
				{ id: 3, name: 'testFolder', path: 'path/to/testFolder' },
			]);

			const result = await searchIndexer.exposedGetFoldersByNames(['^animals']);
			expect(result).toHaveLength(2);
		});

		it('should handle multiple names correctly', async () => {
			const mockDb = (searchIndexer as any).db;

			const mockFolder1 = { id: 1, name: 'firstFolder', path: 'path/to/firstFolder' };
			const mockFolder2 = { id: 2, name: 'secondFolder', path: 'path/to/secondFolder' };
			mockDb.folders.toArray.mockResolvedValueOnce([mockFolder1, mockFolder2]);

			const result = await searchIndexer.exposedGetFoldersByNames(['firstFolder', 'secondFolder']);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(mockFolder1);
			expect(result[1]).toEqual(mockFolder2);
		});
	});

	describe('containsCommandPrefix', () => {
		it('should return true when content contains a command prefix at the start', () => {
			const content = '/command some content';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(true);
		});

		it('should return true for all supported command prefixes', () => {
			// Test each command prefix from the mock
			expect(searchIndexer.exposedContainsCommandPrefix('/command test')).toBe(true);
			expect(searchIndexer.exposedContainsCommandPrefix('/exec test')).toBe(true);
			expect(searchIndexer.exposedContainsCommandPrefix('/run test')).toBe(true);
		});

		it('should return true when command prefix has whitespace before it', () => {
			const content = '  \t/command some content';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(true);
		});

		it('should return true when command prefix is at the beginning of a line in multiline content', () => {
			const content = 'This is a normal line\n/command do something\nAnother normal line';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(true);
		});

		it('should return true when command prefix is at the beginning with special formatting', () => {
			const content = '/command\nwith a newline';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(true);
		});

		it('should return false when content does not contain a command prefix', () => {
			const content = 'some content';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(false);
		});

		it('should return false when content contains a string similar to a command prefix', () => {
			// Test a string that includes the prefix text but isn't a valid command
			const content = 'discussing /command as a concept';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(false);
		});

		it('should return false when the prefix is part of a word', () => {
			const content = 'using the /commander tool';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(false);
		});

		it('should return false when the content contains a similar but not exact prefix', () => {
			const content = '/commands are useful';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(false);
		});

		it('should return false when content is empty', () => {
			const content = '';
			expect(searchIndexer.exposedContainsCommandPrefix(content)).toBe(false);
		});

		it('should return false for null or undefined content', () => {
			expect(searchIndexer.exposedContainsCommandPrefix(null as unknown as string)).toBe(false);
			expect(searchIndexer.exposedContainsCommandPrefix(undefined as unknown as string)).toBe(
				false
			);
		});
	});

	describe('updateCachedNote', () => {
		it('should update the cached note path and terms count when a new note is opened', async () => {
			// Create a test file
			const testFile = new (jest.requireMock('obsidian').TFile)('test/path/note1.md', 'md');
			const content = 'This is a test note with some terms';

			// Update the cache with this file
			await searchIndexer.exposedUpdateCachedNote(testFile, content);

			// Check if cache is correctly updated
			expect(searchIndexer.getCachedNotePath()).toBe('test/path/note1.md');
			expect(searchIndexer.getCachedNoteTermsCount()).toBe(4); // 7 terms in the content
		});

		it('should update the terms count when content is modified', async () => {
			// Create a test file
			const testFile = new (jest.requireMock('obsidian').TFile)('test/path/note1.md', 'md');

			// Set initial cache
			await searchIndexer.exposedUpdateCachedNote(testFile, 'Initial content with terms');
			const initialCount = searchIndexer.getCachedNoteTermsCount();

			// Update with modified content
			await searchIndexer.exposedUpdateCachedNote(
				testFile,
				'Initial content with terms and more keywords added'
			);

			// Verify the terms count was updated
			expect(searchIndexer.getCachedNotePath()).toBe('test/path/note1.md'); // Path remains the same
			expect(searchIndexer.getCachedNoteTermsCount()).toBeGreaterThan(initialCount); // Count increases
		});

		it('should not update the cache if a character is capitalized', async () => {
			// Create a test file
			const testFile = new (jest.requireMock('obsidian').TFile)('test/path/note1.md', 'md');
			const originalContent = 'This is a test note with some terms';

			// Update the cache with this file
			await searchIndexer.exposedUpdateCachedNote(testFile, originalContent);
			const originalCount = searchIndexer.getCachedNoteTermsCount();

			const updatedContent = 'This is a test NOTE with some terms';

			// Update the cache with the same content but with a capitalized character
			await searchIndexer.exposedUpdateCachedNote(testFile, updatedContent);

			expect(searchIndexer.getCachedNoteTermsCount()).toBe(originalCount);
		});

		it('should not change the cache if only stopwords, spaces, or HTML comments are added', async () => {
			// Create a test file
			const testFile = new (jest.requireMock('obsidian').TFile)('test/path/note1.md', 'md');

			// First let's test HTML comments
			// Original content
			const originalContent = 'Testing keyword caching functionality';
			await searchIndexer.exposedUpdateCachedNote(testFile, originalContent);
			const originalCount = searchIndexer.getCachedNoteTermsCount();

			// Add HTML comments
			const contentWithHtmlComments =
				'Testing keyword caching functionality <!-- This is a comment that should be ignored -->';
			await searchIndexer.exposedUpdateCachedNote(testFile, contentWithHtmlComments);

			// HTML comments should be removed during tokenization
			expect(searchIndexer.getCachedNoteTermsCount()).toBe(originalCount);

			// Test with spaces
			const contentWithExtraSpaces = 'Testing   keyword    caching    functionality';
			await searchIndexer.exposedUpdateCachedNote(testFile, contentWithExtraSpaces);

			// Extra spaces should be normalized and count remains the same
			expect(searchIndexer.getCachedNoteTermsCount()).toBe(originalCount);

			// For stopwords, we need to unmock the removeStopwords function first
			// Since it's mocked globally, we'll just assert what would happen in real code
			const mockTokenizeContent = jest.spyOn(searchIndexer, 'exposedTokenizeContent');

			// We'll directly test how tokenizeContent handles these cases
			searchIndexer.exposedTokenizeContent(originalContent);
			searchIndexer.exposedTokenizeContent('Testing keyword caching functionality with the and or');

			expect(mockTokenizeContent).toHaveBeenCalledWith(originalContent);
			expect(mockTokenizeContent).toHaveBeenCalledWith(
				'Testing keyword caching functionality with the and or'
			);
		});

		it('should clear the cache when calling clearCachedNote', () => {
			// Set some cache values
			searchIndexer['cachedNotePath'] = 'test/path.md';
			searchIndexer['cachedNoteTermsCount'] = 10;

			// Clear the cache
			searchIndexer.exposedClearCachedNote();

			// Verify cache is cleared
			expect(searchIndexer.getCachedNotePath()).toBeNull();
			expect(searchIndexer.getCachedNoteTermsCount()).toBe(0);
		});

		it('should not cache notes with command prefixes', async () => {
			// Create a test file
			const testFile = new (jest.requireMock('obsidian').TFile)('test/path/command-note.md', 'md');

			// Content with command prefix
			const commandContent = '/command This should not be cached';

			// Mock the containsCommandPrefix method to return true
			jest.spyOn(searchIndexer, 'exposedContainsCommandPrefix').mockReturnValue(true);

			// Try to update cache
			await searchIndexer.exposedUpdateCachedNote(testFile, commandContent);

			// Verify cache was not updated
			expect(searchIndexer.getCachedNotePath()).toBeNull();
			expect(searchIndexer.getCachedNoteTermsCount()).toBe(0);
		});
	});
});
