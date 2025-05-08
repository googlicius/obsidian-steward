import { generateText, classify } from 'modelfusion';
import { createLLMGenerator } from './llmConfig';
import { commandIntentPrompt } from './prompts/commandIntentPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { intentClassifier } from './classifiers/intent';
import { logger } from 'src/utils/logger';

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

/**
 * Extract command intent from a general query using AI
 * @param userInput Natural language request from the user
 * @param llmConfig LLM configuration settings
 * @returns Extracted command type, content, and explanation
 */
export async function extractCommandIntent(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<CommandIntentExtraction> {
	try {
		let classificationResult = null;
		try {
			// Race between classification and timeout
			classificationResult = await Promise.race([
				classify({
					model: intentClassifier,
					value: userInput,
				}),
				new Promise<null>(resolve => {
					setTimeout(() => resolve(null), 2000);
				}),
			]);

			if (classificationResult) {
				logger.log(`The user input was classified as "${classificationResult}"`);

				// Create a formatted response based on the classification
				const result: CommandIntentExtraction = {
					commandType: classificationResult,
					content: userInput,
					explanation: `Classified as ${classificationResult} command based on semantic similarity.`,
					confidence: 0.8,
					lang: 'en',
				};

				return result;
			}
		} catch (error) {
			logger.log('Classification unavailable, continuing with LLM generation:', error);
		}

		// Proceed with LLM-based intent extraction
		logger.log('Using LLM for intent extraction');
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			prompt: [userLanguagePrompt, commandIntentPrompt, { role: 'user', content: userInput }],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		const validatedResult = validateCommandIntentExtraction(parsed);

		if (validatedResult.confidence > 0.8) {
			try {
				await intentClassifier.saveEmbedding(userInput, validatedResult.commandType);
			} catch (error) {
				logger.error('Failed to save query embedding:', error);
			}
		}

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
			'image',
			'audio',
			'update',
			'update_from_search_result',
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
