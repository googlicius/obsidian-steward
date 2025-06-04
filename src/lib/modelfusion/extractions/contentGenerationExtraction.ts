import { generateText } from 'modelfusion';
import { createLLMGenerator } from '../llmConfig';
import { contentGenerationPrompt } from '../prompts/contentGenerationPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';

// Get the singleton instance of AbortService
const abortService = AbortService.getInstance();

export interface ContentGenerationExtraction {
	responses: string[];
	explanation: string;
	confidence: number;
}

/**
 * Extract content generation details from a user query
 * @param userInput Natural language request from the user
 * @param llmConfig LLM configuration settings
 * @returns Extracted generated content, explanation, and confidence
 */
export async function extractContentGeneration(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<ContentGenerationExtraction> {
	try {
		logger.log('Extracting content generation from user input');

		// Create an operation-specific abort signal
		const abortSignal = abortService.createAbortController('content-generation');

		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal },
			prompt: [
				userLanguagePrompt,
				contentGenerationPrompt,
				{
					role: 'user',
					content: userInput,
				},
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateContentGenerationExtraction(parsed);
	} catch (error) {
		// Check if this is an AbortError
		if (error.name === 'AbortError') {
			logger.log('Content generation was aborted');
			return {
				responses: [],
				explanation: 'The operation was cancelled.',
				confidence: 0,
			};
		}

		logger.error('Error extracting content generation details:', error);
		throw error;
	}
}

/**
 * Validate that the content generation extraction contains all required fields
 */
function validateContentGenerationExtraction(data: any): ContentGenerationExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (!Array.isArray(data.responses)) {
		throw new Error('Responses must be an array');
	}

	// Validate each response in the array
	for (const response of data.responses) {
		if (typeof response !== 'string') {
			throw new Error('Generated content must be a string');
		}
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	return {
		responses: data.responses,
		explanation: data.explanation,
		confidence: data.confidence,
	};
}
