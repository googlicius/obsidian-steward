import { generateText } from 'modelfusion';
import { destinationFolderPrompt } from './prompts/destinationFolderPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { createLLMGenerator } from './llmConfig';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { validateConfidence, validateLanguage } from './validators';

/**
 * Represents the extracted move from search results parameters
 */
export interface MoveFromSearchResultExtraction {
	destinationFolder: string;
	explanation: string;
	confidence: number;
	lang?: string;
}

/**
 * Extract destination folder from a user query for moving search results
 * @param userInput Natural language request to move files from search results
 * @returns Extracted destination folder
 */
export async function extractMoveFromSearchResult(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<MoveFromSearchResultExtraction> {
	try {
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			prompt: [
				userLanguagePrompt,
				destinationFolderPrompt,
				confidenceScorePrompt,
				{
					role: 'user',
					content: userInput,
				},
			],
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

	const confidence = validateConfidence(data.confidence);
	const lang = validateLanguage(data.lang);

	return {
		destinationFolder: data.destinationFolder.trim(),
		explanation: data.explanation.trim(),
		confidence,
		lang,
	};
}
