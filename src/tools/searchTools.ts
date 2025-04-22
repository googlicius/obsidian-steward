import { App } from 'obsidian';
import { SearchIndexer } from '../searchIndexer';
import { generateText, openai } from 'modelfusion';
import { searchExtractQueryPrompt } from '../lib/modelfusion/prompts';
import { userLanguagePrompt } from '../lib/modelfusion/prompts/languagePrompt';

/**
 * Represents the extracted search query from a natural language request
 */
export interface SearchQueryExtraction {
	searchQuery: string;
	explanation: string;
	lang?: string;
}

export class SearchTool {
	constructor(
		private readonly app: App,
		private searchIndexer: SearchIndexer
	) {}

	/**
	 * Extract a search query from a natural language request using AI
	 * @param userInput Natural language request from the user
	 * @returns Extracted search query and explanation
	 */
	async extractSearchQuery(userInput: string): Promise<SearchQueryExtraction> {
		try {
			// Use ModelFusion to generate the response
			const response = await generateText({
				model: openai.ChatTextGenerator({
					model: 'gpt-4-turbo-preview',
					temperature: 0.2,
					responseFormat: { type: 'json_object' },
				}),
				prompt: [
					userLanguagePrompt,
					searchExtractQueryPrompt,
					{ role: 'user', content: userInput },
				],
			});

			// Parse and validate the JSON response
			const parsed = JSON.parse(response);
			return this.validateSearchQueryExtraction(parsed);
		} catch (error) {
			console.error('Error extracting search query:', error);
			throw error;
		}
	}

	/**
	 * Validate that the search query extraction contains all required fields
	 */
	private validateSearchQueryExtraction(data: any): SearchQueryExtraction {
		if (!data || typeof data !== 'object') {
			throw new Error('Invalid response format');
		}

		if (typeof data.searchQuery !== 'string' || !data.searchQuery.trim()) {
			throw new Error('Search query must be a non-empty string');
		}

		if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
			throw new Error('Explanation must be a non-empty string');
		}

		// Lang is optional, but if provided, must be a valid string
		const lang =
			data.lang && typeof data.lang === 'string' && data.lang.trim() ? data.lang.trim() : 'en';

		return {
			searchQuery: data.searchQuery,
			explanation: data.explanation,
			lang,
		};
	}
}
