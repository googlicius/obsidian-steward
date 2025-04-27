import { App } from 'obsidian';
import { SearchResult } from '../searchIndexer';
import { generateText, openai } from 'modelfusion';
import { moveQueryPrompt } from '../lib/modelfusion/prompts';
import { userLanguagePrompt } from '../lib/modelfusion/prompts/languagePrompt';
import { SearchTool } from './searchTools';
import { CommandIntentExtraction, extractCommandIntent } from '../lib/modelfusion/intentExtraction';
import { MoveOperationV2 } from 'src/lib/modelfusion';
import { IndexedDocument } from 'src/database/PluginDatabase';

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

export class ObsidianAPITools {
	constructor(
		private readonly app: App,
		private readonly searchTool: SearchTool
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
	 * Get files for all operations in a move query extraction
	 * @param queryExtraction The extracted move query parameters
	 * @returns Map of operation index to array of search results
	 */
	async getFilesByMoveQueryExtraction(
		queryExtraction: MoveQueryExtraction
	): Promise<Map<number, SearchResult[]>> {
		const filesByOperation = new Map<number, SearchResult[]>();

		// Process each operation
		for (let i = 0; i < queryExtraction.operations.length; i++) {
			// Find files matching the source query
			// const results = await this.searchTool.getFilesByQuery(operation.sourceQuery);
			const results: SearchResult[] = [];
			filesByOperation.set(i, results);
		}

		return filesByOperation;
	}

	/**
	 * Move files based on operations and search results
	 * @param operations Array of MoveOperationV2 objects containing destination folders and keywords
	 * @param filesByOperation Map of operation index to files to move
	 * @returns Results of the move operations
	 */
	async moveByOperations(
		operations: MoveOperationV2[],
		filesByOperation: Map<number, IndexedDocument[]>
	): Promise<{
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
		for (let i = 0; i < operations.length; i++) {
			const operation = operations[i];

			// Get the files for this operation
			const results = filesByOperation.get(i) || [];

			// Process the move operations
			const moved: string[] = [];
			const errors: string[] = [];
			const skipped: string[] = [];

			for (const result of results) {
				const filePath = result.path;
				if (!filePath) continue;

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
				sourceQuery: operation.keywords ? operation.keywords.join(', ') : 'Search results',
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
		return extractCommandIntent(userInput);
	}
}
