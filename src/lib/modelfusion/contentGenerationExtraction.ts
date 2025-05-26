import { generateText } from 'modelfusion';
import { createLLMGenerator } from './llmConfig';
import { contentGenerationPrompt } from './prompts/contentGenerationPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { logger } from '../../utils/logger';

export interface ContentGeneration {
	generatedContent: string;
}

export interface ContentGenerationExtraction {
	responses: ContentGeneration[];
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

		const response = await generateText({
			model: createLLMGenerator(llmConfig),
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
		if (typeof response !== 'object') {
			throw new Error('Each response must be an object');
		}

		if (typeof response.generatedContent !== 'string') {
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
