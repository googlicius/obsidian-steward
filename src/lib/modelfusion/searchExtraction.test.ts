import { extractSearchQueryV2 } from './searchExtraction';

// Mock the language utility
jest.mock('../../utils/getObsidianLanguage', () => ({
	getObsidianLanguage: () => 'en',
}));

// Mock the ModelFusion generateText to avoid actual API calls
jest.mock('modelfusion', () => ({
	generateText: jest.fn(),
	openai: {
		ChatTextGenerator: jest.fn(),
	},
}));

describe('extractSearchQueryV2', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should handle quoted keyword input directly without LLM', async () => {
		// Test with double quotes
		const result1 = await extractSearchQueryV2('"project notes"');

		expect(result1).toEqual({
			operations: [
				{
					keywords: ['project notes'],
					tags: [],
					filenames: [],
					folders: [],
				},
			],
			explanation: 'Searching for "project notes"',
			lang: 'en',
			confidence: 1,
		});

		// Test with single quotes
		const result2 = await extractSearchQueryV2("'meeting minutes'");

		expect(result2).toEqual({
			operations: [
				{
					keywords: ['meeting minutes'],
					tags: [],
					filenames: [],
					folders: [],
				},
			],
			explanation: 'Searching for "meeting minutes"',
			lang: 'en',
			confidence: 1,
		});
	});

	it('should handle tag-only input directly without LLM', async () => {
		// Test with multiple tags
		const result = await extractSearchQueryV2('#project #work #important');

		expect(result).toEqual({
			operations: [
				{
					keywords: [],
					tags: ['project', 'work', 'important'],
					filenames: [],
					folders: [],
				},
			],
			explanation: 'Searching for tags: #project, #work, #important',
			lang: 'en',
			confidence: 1,
		});

		// Test with a single tag
		const singleTagResult = await extractSearchQueryV2('#urgent');

		expect(singleTagResult).toEqual({
			operations: [
				{
					keywords: [],
					tags: ['urgent'],
					filenames: [],
					folders: [],
				},
			],
			explanation: 'Searching for tags: #urgent',
			lang: 'en',
			confidence: 1,
		});
	});
});
