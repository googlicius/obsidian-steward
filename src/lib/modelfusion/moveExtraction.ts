import { generateText, openai } from 'modelfusion';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { validateLanguage, validateConfidence } from './validators';
import { SearchOperationV2 } from './searchExtraction';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { searchPromptV2 } from './prompts/searchPromptV2';

/**
 * Represents a single move operation with v2 parameters
 */
export interface MoveOperationV2 extends SearchOperationV2 {
	destinationFolder: string;
}

/**
 * Represents the extracted move parameters from a natural language request (v2)
 */
export interface MoveQueryExtractionV2 {
	operations: MoveOperationV2[];
	explanation: string;
	lang?: string;
	confidence: number;
}

/**
 * Extract move parameters from a natural language request using AI (v2)
 * This combines the search v2 extraction with the move v2 prompt to get comprehensive parameters
 * @param userInput Natural language request from the user
 * @returns Extracted move parameters and explanation
 */
export async function extractMoveQueryV2(userInput: string): Promise<MoveQueryExtractionV2> {
	try {
		// Use ModelFusion to add the move parameters
		const response = await generateText({
			model: openai.ChatTextGenerator({
				model: 'gpt-4-turbo-preview',
				temperature: 0.2,
				responseFormat: { type: 'json_object' },
			}),
			prompt: [
				userLanguagePrompt,
				searchPromptV2,
				confidenceScorePrompt,
				{
					role: 'user',
					content: userInput,
				},
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateMoveQueryExtractionV2(parsed);
	} catch (error) {
		console.error('Error extracting move query:', error);
		throw error;
	}
}

/**
 * Validate that the move query extraction v2 contains all required fields
 */
function validateMoveQueryExtractionV2(data: any): MoveQueryExtractionV2 {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (!Array.isArray(data.operations)) {
		throw new Error('Operations must be an array');
	}

	// Validate each operation
	data.operations.forEach((op: any, index: number) => {
		if (!Array.isArray(op.keywords)) {
			throw new Error(`Operation ${index}: keywords must be an array`);
		}
		if (!Array.isArray(op.tags)) {
			throw new Error(`Operation ${index}: tags must be an array`);
		}
		if (!Array.isArray(op.filenames)) {
			throw new Error(`Operation ${index}: filenames must be an array`);
		}
		if (!Array.isArray(op.folders)) {
			throw new Error(`Operation ${index}: folders must be an array`);
		}
		if (typeof op.destinationFolder !== 'string' || !op.destinationFolder.trim()) {
			throw new Error(`Operation ${index}: destinationFolder must be a non-empty string`);
		}
	});

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	const lang = validateLanguage(data.lang);
	const confidence = validateConfidence(data.confidence);

	// Create a validated result
	const result: MoveQueryExtractionV2 = {
		operations: data.operations,
		explanation: data.explanation,
		lang,
		confidence,
	};

	return result;
}
