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

/**
 * Represents the extracted move command parameters from a natural language request
 */
export interface MoveQueryExtraction {
	sourceQuery: string;
	destinationFolder: string;
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
	 * Move a file to a different location in the vault
	 * @param filePath Current path of the file
	 * @param newFolderPath Destination folder path
	 * @returns Success or failure
	 */
	async moveFile(filePath: string, newFolderPath: string): Promise<boolean> {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file) {
				return false;
			}

			// Ensure the destination folder exists
			await this.ensureFolderExists(newFolderPath);

			// Create the new path (keep the same filename)
			const fileName = filePath.split('/').pop();
			const newPath = `${newFolderPath}/${fileName}`.replace(/\/+/g, '/');

			// Move the file
			await this.app.fileManager.renameFile(file, newPath);
			return true;
		} catch (error) {
			console.error(`Error moving file ${filePath} to ${newFolderPath}:`, error);
			return false;
		}
	}

	/**
	 * Ensure a folder exists, creating it if necessary
	 * @param folderPath The folder path to ensure exists
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		// Skip if folder already exists
		if (this.app.vault.getAbstractFileByPath(folderPath)) {
			return;
		}

		// Create the folder
		await this.app.vault.createFolder(folderPath);
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
	 * Extract move command parameters from a natural language request using AI
	 * @param userInput Natural language request from the user
	 * @returns Extracted source query, destination folder, and explanation
	 */
	async extractMoveQuery(userInput: string): Promise<MoveQueryExtraction> {
		try {
			const systemPrompt = `You are a helpful assistant that extracts move command parameters from user queries for an Obsidian note system.

Your job is to analyze the user's natural language request to move files and extract:
1. The search query to find files to move
2. The destination folder where files should be moved to

Guidelines:
- The source query should be keywords or tags to identify files to move
- If the user wants to move files with specific tags, format them as "#tag1 #tag2 #tag3"
- The destination folder should be a path within the Obsidian vault
- If the destination folder doesn't exist, it will be created
- Ensure the destination folder starts without a slash and doesn't end with a slash

You must respond with a valid JSON object containing these properties:
- sourceQuery: The search query to find files to move
- destinationFolder: The folder path where files should be moved to
- explanation: A brief explanation of how you interpreted the move command

Examples:
1. User: "Move all my project notes to the Projects folder"
   Response: { "sourceQuery": "project", "destinationFolder": "Projects", "explanation": "Moving notes about projects to the Projects folder" }

2. User: "Move files tagged with #draft to my Drafts/InProgress folder"
   Response: { "sourceQuery": "#draft", "destinationFolder": "Drafts/InProgress", "explanation": "Moving notes tagged with #draft to the Drafts/InProgress folder" }`;

			// Use ModelFusion to generate the response
			const response = await generateText({
				model: openai.ChatTextGenerator({
					model: 'gpt-4-turbo-preview',
					temperature: 0.1,
					responseFormat: { type: 'json_object' },
				}),
				prompt: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userInput },
				],
			});

			// Parse and validate the JSON response
			const parsed = JSON.parse(response);
			return this.validateMoveQueryExtraction(parsed);
		} catch (error) {
			console.error('Error extracting move query:', error);
			throw error;
		}
	}

	/**
	 * Validate that the move query extraction contains all required fields
	 */
	private validateMoveQueryExtraction(data: any): MoveQueryExtraction {
		if (!data || typeof data !== 'object') {
			throw new Error('Invalid response format');
		}

		if (typeof data.sourceQuery !== 'string' || !data.sourceQuery.trim()) {
			throw new Error('Source query must be a non-empty string');
		}

		if (typeof data.destinationFolder !== 'string' || !data.destinationFolder.trim()) {
			throw new Error('Destination folder must be a non-empty string');
		}

		if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
			throw new Error('Explanation must be a non-empty string');
		}

		return {
			sourceQuery: data.sourceQuery,
			destinationFolder: data.destinationFolder,
			explanation: data.explanation,
		};
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

	/**
	 * Enhanced move that uses AI to extract move command parameters from natural language queries
	 * @param userQuery Natural language query from the user
	 * @returns Results of the move operation and the query extraction
	 */
	async enhancedMove(userQuery: string): Promise<{
		result: { moved: string[]; errors: string[] };
		queryExtraction: MoveQueryExtraction;
	}> {
		// Extract the move parameters using AI
		const queryExtraction = await this.extractMoveQuery(userQuery);

		// Find files matching the source query
		const results = await this.search(queryExtraction.sourceQuery);

		// Process the move operations
		const moved: string[] = [];
		const errors: string[] = [];

		for (const result of results) {
			const filePath = result.path;
			const success = await this.moveFile(filePath, queryExtraction.destinationFolder);

			if (success) {
				moved.push(filePath);
			} else {
				errors.push(filePath);
			}
		}

		return {
			result: { moved, errors },
			queryExtraction,
		};
	}
}
