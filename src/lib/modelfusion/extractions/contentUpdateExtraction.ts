import { generateText } from 'modelfusion';
import { createLLMGenerator } from '../llmConfig';
import { contentUpdatePrompt } from '../prompts/contentUpdatePrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { logger } from 'src/utils/logger';
import { AbortService } from 'src/services/AbortService';

const abortService = AbortService.getInstance();

export interface ContentUpdate {
	updatedContent: string;
	originalContent: string;
}

export interface ContentUpdateExtraction {
	updates: ContentUpdate[];
	explanation: string;
	confidence: number;
}

/**
 * Extract content update details from a user query
 * @param params Parameters for content update extraction
 * @returns Extracted updated contents, explanation, and confidence
 */
export async function extractContentUpdate(params: {
	userInput: string;
	systemPrompts?: string[];
	llmConfig: StewardPluginSettings['llm'];
}): Promise<ContentUpdateExtraction> {
	const { userInput, systemPrompts = [], llmConfig } = params;

	try {
		logger.log('Extracting content update from user input');

		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('content-update') },
			prompt: [
				userLanguagePrompt,
				contentUpdatePrompt,
				...systemPrompts.map(prompt => ({ role: 'system', content: prompt })),
				{
					role: 'user',
					content: userInput,
				},
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateContentUpdateExtraction(parsed);
	} catch (error) {
		logger.error('Error extracting content update details:', error);
		throw error;
	}
}

/**
 * Validate that the content update extraction contains all required fields
 */
function validateContentUpdateExtraction(data: any): ContentUpdateExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (!Array.isArray(data.updates)) {
		throw new Error('Updates must be an array');
	}

	// Validate each update in the array
	for (const update of data.updates) {
		if (typeof update !== 'object') {
			throw new Error('Each update must be an object');
		}

		if (typeof update.updatedContent !== 'string') {
			throw new Error('Updated content must be a string');
		}

		if (typeof update.originalContent !== 'string') {
			throw new Error('Original content must be a string');
		}
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	return {
		updates: data.updates,
		explanation: data.explanation,
		confidence: data.confidence,
	};
}
