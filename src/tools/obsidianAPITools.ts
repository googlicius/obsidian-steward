import { App } from 'obsidian';
import { SearchIndexer, SearchResult } from '../searchIndexer';
import { generateText, openai } from 'modelfusion';

/**
 * Represents the extracted search query from a natural language request
 */
export interface SearchQueryExtraction {
	searchQuery: string;
	explanation: string;
}

export class ObsidianAPITools {
	constructor(
		private readonly app: App,
		private searchIndexer: SearchIndexer
	) {}

	async createNewFile(title: string, content: string) {
		const file = await this.app.vault.create(`${title}.md`, content);
		return file;
	}

	/**
	 * Search for files containing the query term
	 * @param query Search query
	 * @param limit Maximum number of results to return
	 */
	async search(query: string, limit = 10): Promise<SearchResult[]> {
		return this.searchIndexer.search(query, limit);
	}

	/**
	 * Extract a search query from a natural language request using AI
	 * @param userInput Natural language request from the user
	 * @returns Extracted search query and explanation
	 */
	async extractSearchQuery(userInput: string): Promise<SearchQueryExtraction> {
		try {
			const systemPrompt = `You are a helpful assistant that extracts search keywords from user queries for an Obsidian note search system.

Your job is to analyze the user's natural language request and extract the most relevant search keywords or tags.

Guidelines:
- If the user is looking for notes with specific tags, format them as "#tag1 #tag2 #tag3"
- If the user is looking for general keywords, extract them and separate with spaces
- Consider synonyms and related terms that might be helpful
- Simplify complex queries into the most essential search terms

You must respond with a valid JSON object containing these properties:
- searchQuery: The extracted search query as a string (tags or keywords)
- explanation: A brief explanation of how you interpreted the query

Examples:
1. User: "Help me find all notes with tags generated, noun, and verb"
   Response: { "searchQuery": "#generated #noun #verb", "explanation": "Searching for notes tagged with generated, noun, and verb" }

2. User: "I need to find my notes about climate change impacts on agriculture"
   Response: { "searchQuery": "climate change agriculture impact", "explanation": "Searching for notes about climate change's impact on agriculture" }`;

			// Use ModelFusion to generate the response
			const response = await generateText({
				model: openai.ChatTextGenerator({
					model: 'gpt-4-turbo-preview',
					temperature: 0.2,
					responseFormat: { type: 'json_object' },
				}),
				prompt: [
					{ role: 'system', content: systemPrompt },
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

		return {
			searchQuery: data.searchQuery,
			explanation: data.explanation,
		};
	}

	/**
	 * Enhanced search that uses AI to extract search keywords from natural language queries
	 * @param userQuery Natural language query from the user
	 * @param limit Maximum number of results to return
	 * @returns Search results and the explanation of the query interpretation
	 */
	async enhancedSearch(
		userQuery: string,
		limit = 10
	): Promise<{
		results: SearchResult[];
		queryExtraction: SearchQueryExtraction;
	}> {
		// Extract the search query using AI
		const queryExtraction = await this.extractSearchQuery(userQuery);

		// Perform the search using the extracted query
		const results = await this.search(queryExtraction.searchQuery, limit);

		return {
			results,
			queryExtraction,
		};
	}
}
