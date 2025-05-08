import { generateText, openai } from 'modelfusion';
import { destinationFolderPrompt } from './prompts/destinationFolderPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';

/**
 * Represents the extracted move from search results parameters
 */
export interface MoveFromSearchResultExtraction {
	destinationFolder: string;
	explanation: string;
	lang?: string;
}

/**
 * Extract destination folder from a user query for moving search results
 * @param userInput Natural language request to move files from search results
 * @returns Extracted destination folder
 */
export async function extractMoveFromSearchResult(
	userInput: string
): Promise<MoveFromSearchResultExtraction> {
	try {
		// Use ModelFusion to generate the response
		const response = await generateText({
			model: openai.ChatTextGenerator({
				model: 'gpt-4-turbo-preview',
				temperature: 0.2,
				responseFormat: { type: 'json_object' },
			}),
			prompt: [userLanguagePrompt, destinationFolderPrompt, { role: 'user', content: userInput }],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateMoveFromSearchResultExtraction(parsed);
	} catch (error) {
		console.error('Error extracting move from search result parameters:', error);
		throw error;
	}
}

/**
 * Validate that the move from search results extraction contains all required fields
 */
function validateMoveFromSearchResultExtraction(data: any): MoveFromSearchResultExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (typeof data.destinationFolder !== 'string' || !data.destinationFolder.trim()) {
		throw new Error('Destination folder must be a non-empty string');
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	return {
		destinationFolder: data.destinationFolder.trim(),
		explanation: data.explanation.trim(),
		lang: data.lang,
	};
}
