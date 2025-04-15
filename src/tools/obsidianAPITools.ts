import { App } from 'obsidian';
import { SearchIndexer, SearchResult } from '../searchIndexer';
import { generateText, openai } from 'modelfusion';
import {
	moveQueryPrompt,
	searchExtractQueryPrompt,
	userLanguagePrompt,
	commandIntentPrompt,
} from '../lib/modelfusion/prompts';

/**
 * Represents the extracted search query from a natural language request
 */
export interface SearchQueryExtraction {
	searchQuery: string;
	explanation: string;
	lang?: string;
}

/**
 * Represents a single move operation
 */
export interface MoveOperation {
	sourceQuery: string;
	destinationFolder: string;
}

/**
 * Represents the extracted move command parameters from a natural language request
 */
export interface MoveQueryExtraction {
	operations: MoveOperation[];
	explanation: string;
	lang?: string;
}

/**
 * Represents the extracted command intent from a general query
 */
export interface CommandIntentExtraction {
	commandType: string;
	content: string;
	explanation: string;
	confidence: number;
	lang?: string;
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
	 * Extract move command parameters from a natural language request using AI
	 * @param userInput Natural language request from the user
	 * @returns Extracted source query, destination folder, and explanation
	 */
	async extractMoveQuery(userInput: string): Promise<MoveQueryExtraction> {
		try {
			// Use ModelFusion to generate the response
			const response = await generateText({
				model: openai.ChatTextGenerator({
					model: 'gpt-4-turbo-preview',
					temperature: 0.2,
					responseFormat: { type: 'json_object' },
				}),
				prompt: [userLanguagePrompt, moveQueryPrompt, { role: 'user', content: userInput }],
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

		if (!Array.isArray(data.operations) || data.operations.length === 0) {
			throw new Error('Operations must be a non-empty array');
		}

		// Validate each operation
		for (const operation of data.operations) {
			if (typeof operation.sourceQuery !== 'string' || !operation.sourceQuery.trim()) {
				throw new Error('Source query must be a non-empty string');
			}

			if (typeof operation.destinationFolder !== 'string' || !operation.destinationFolder.trim()) {
				throw new Error('Destination folder must be a non-empty string');
			}
		}

		if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
			throw new Error('Explanation must be a non-empty string');
		}

		// Lang is optional, but if provided, must be a valid string
		const lang =
			data.lang && typeof data.lang === 'string' && data.lang.trim() ? data.lang.trim() : 'en';

		return {
			operations: data.operations,
			explanation: data.explanation,
			lang,
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

		// Lang is optional, but if provided, must be a valid string
		const lang =
			data.lang && typeof data.lang === 'string' && data.lang.trim() ? data.lang.trim() : 'en';

		return {
			searchQuery: data.searchQuery,
			explanation: data.explanation,
			lang,
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
	 * Move files based on one or more operations
	 * @param queryExtraction The extracted move query parameters
	 * @returns Results of the move operations
	 */
	async moveByQueryExtraction(queryExtraction: MoveQueryExtraction): Promise<{
		operations: Array<{
			sourceQuery: string;
			destinationFolder: string;
			moved: string[];
			errors: string[];
			skipped: string[];
		}>;
	}> {
		const operationResults = [];

		// Process each operation
		for (const operation of queryExtraction.operations) {
			// Find files matching the source query
			const results = await this.search(operation.sourceQuery);

			// Process the move operations
			const moved: string[] = [];
			const errors: string[] = [];
			const skipped: string[] = [];

			for (const result of results) {
				const filePath = result.path;
				const fileName = filePath.split('/').pop() || '';
				const destinationPath = `${operation.destinationFolder}/${fileName}`.replace(/\/+/g, '/');

				// Check if file is already in the destination folder
				if (filePath === destinationPath) {
					skipped.push(filePath);
					continue;
				}

				const success = await this.moveFile(filePath, operation.destinationFolder);

				if (success) {
					moved.push(filePath);
				} else {
					errors.push(filePath);
				}
			}

			operationResults.push({
				sourceQuery: operation.sourceQuery,
				destinationFolder: operation.destinationFolder,
				moved,
				errors,
				skipped,
			});
		}

		return { operations: operationResults };
	}

	/**
	 * Extract command intent from a general query using AI
	 * @param userInput Natural language request from the user
	 * @returns Extracted command type, content, and explanation
	 */
	async extractCommandIntent(userInput: string): Promise<CommandIntentExtraction> {
		try {
			// Use ModelFusion to generate the response
			const response = await generateText({
				model: openai.ChatTextGenerator({
					model: 'gpt-4-turbo-preview',
					temperature: 0.2,
					responseFormat: { type: 'json_object' },
				}),
				prompt: [userLanguagePrompt, commandIntentPrompt, { role: 'user', content: userInput }],
			});

			// Parse and validate the JSON response
			const parsed = JSON.parse(response);
			return this.validateCommandIntentExtraction(parsed);
		} catch (error) {
			console.error('Error extracting command intent:', error);
			throw error;
		}
	}

	/**
	 * Validate that the command intent extraction contains all required fields
	 */
	private validateCommandIntentExtraction(data: any): CommandIntentExtraction {
		if (!data || typeof data !== 'object') {
			throw new Error('Invalid response format');
		}

		if (!['search', 'move', 'calc', 'close', 'confirm'].includes(data.commandType)) {
			throw new Error('Command type must be one of: search, move, calc, close');
		}

		if (typeof data.content !== 'string' || !data.content.trim()) {
			throw new Error('Content must be a non-empty string');
		}

		if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
			throw new Error('Explanation must be a non-empty string');
		}

		if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
			throw new Error('Confidence must be a number between 0 and 1');
		}

		// Lang is optional, but if provided, must be a valid string
		const lang =
			data.lang && typeof data.lang === 'string' && data.lang.trim() ? data.lang.trim() : 'en';

		return {
			commandType: data.commandType,
			content: data.content,
			explanation: data.explanation,
			confidence: data.confidence,
			lang,
		};
	}
}
