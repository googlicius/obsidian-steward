import { generateText, openai } from 'modelfusion';
import { commandIntentPrompt } from './prompts';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { LLMCacheService } from '../../solutions/cache/LLMCacheService';

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

// Create a singleton instance of the cache service
const cacheService = new LLMCacheService();

/**
 * Extract command intent from a general query using AI
 * @param userInput Natural language request from the user
 * @returns Extracted command type, content, and explanation
 */
export async function extractCommandIntent(userInput: string): Promise<CommandIntentExtraction> {
	try {
		// First check if we have a cached response
		const cachedResponse = await cacheService.getCachedResponse(userInput);
		if (cachedResponse) {
			const parsed = JSON.parse(cachedResponse);
			return validateCommandIntentExtraction(parsed);
		}

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
		const validatedResult = validateCommandIntentExtraction(parsed);

		// Cache the response with the validated command type
		await cacheService.cacheResponse(userInput, response, validatedResult.commandType);

		return validatedResult;
	} catch (error) {
		console.error('Error extracting command intent:', error);
		throw error;
	}
}

/**
 * Validate that the command intent extraction contains all required fields
 */
function validateCommandIntentExtraction(data: any): CommandIntentExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (
		![
			'search',
			'move',
			'copy',
			'delete',
			'move_from_search_result',
			'calc',
			'close',
			'confirm',
			'revert',
		].includes(data.commandType)
	) {
		throw new Error(
			'Command type must be one of: search, move, copy, delete, move_from_search_result, calc, close, confirm, revert'
		);
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
