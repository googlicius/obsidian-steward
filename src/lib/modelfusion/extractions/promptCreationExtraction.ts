import { generateText } from 'modelfusion';
import { createLLMGenerator } from '../llmConfig';
import { promptCreationPrompt } from '../prompts/promptCreationPrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { logger } from 'src/utils/logger';

/**
 * Represents a custom prompt structure
 */
export interface CustomPrompt {
	commandName: string;
	content: string;
	description: string;
	examples?: string[];
}

/**
 * Extract and create a custom prompt based on user input
 * @param userInput Natural language request from the user
 * @param llmConfig LLM configuration settings
 * @returns Created custom prompt structure
 */
export async function extractPromptCreation(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<CustomPrompt> {
	try {
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			prompt: [
				promptCreationPrompt,
				{
					role: 'user',
					content: userInput,
				},
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateCustomPrompt(parsed);
	} catch (error) {
		logger.error('Error extracting prompt creation:', error);
		throw error;
	}
}

/**
 * Validate that the custom prompt contains all required fields
 */
function validateCustomPrompt(data: any): CustomPrompt {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (typeof data.commandName !== 'string' || !data.commandName.trim()) {
		throw new Error('Command name must be a non-empty string');
	}

	if (typeof data.content !== 'string' || !data.content.trim()) {
		throw new Error('Content must be a non-empty string');
	}

	if (typeof data.description !== 'string' || !data.description.trim()) {
		throw new Error('Description must be a non-empty string');
	}

	// Examples are optional, but if provided, must be an array of strings
	const examples =
		data.examples && Array.isArray(data.examples)
			? data.examples.filter((ex: any) => typeof ex === 'string' && ex.trim())
			: undefined;

	return {
		commandName: data.commandName.trim(),
		content: data.content.trim(),
		description: data.description.trim(),
		examples,
	};
}
