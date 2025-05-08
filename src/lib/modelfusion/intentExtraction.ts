import { generateText, classify, OpenAIChatMessage } from 'modelfusion';
import { createLLMGenerator } from './llmConfig';
import { commandIntentPrompt } from './prompts/commandIntentPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { intentClassifier } from './classifiers/intent';
import { logger } from 'src/utils/logger';
import {
	interpretDeleteFromSearchResultPrompt,
	interpretSearchContentPrompt,
	interpretUpdateFromSearchResultPrompt,
} from './prompts/interpretQueryPrompts';
import { destinationFolderPrompt } from './prompts/destinationFolderPrompt';

/**
 * Represents a single command in a sequence
 */
export interface CommandIntent {
	commandType: string;
	content: string;
}

/**
 * Represents the extracted command intents from a general query
 */
export interface CommandIntentExtraction {
	commands: CommandIntent[];
	explanation: string;
	confidence: number;
	lang?: string;
	queryTemplate?: string;
}

/**
 * Extract command intents from a general query using AI
 * @param userInput Natural language request from the user
 * @param llmConfig LLM configuration settings
 * @returns Extracted command types, content, and explanation
 */
export async function extractCommandIntent(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<CommandIntentExtraction> {
	try {
		const clusterName = await classify({
			model: intentClassifier,
			value: userInput,
		});

		const additionalPrompts: OpenAIChatMessage[] = [];

		if (clusterName) {
			logger.log(`The user input was classified as "${clusterName}"`);

			const clusterNames = clusterName.split(':');

			if (clusterNames.length > 1) {
				// Add some additional prompts to extract multiple intents
				if (clusterNames.includes('search')) {
					additionalPrompts.push(interpretSearchContentPrompt);
				}
				if (clusterNames.includes('delete_from_search_result')) {
					additionalPrompts.push(interpretDeleteFromSearchResultPrompt);
				}
				if (
					clusterNames.includes('copy_from_search_result') ||
					clusterNames.includes('move_from_search_result')
				) {
					additionalPrompts.push(destinationFolderPrompt);
				}
				if (clusterNames.includes('update_from_search_result')) {
					additionalPrompts.push(interpretUpdateFromSearchResultPrompt);
				}
			} else {
				// Create a formatted response based on the classification
				const result: CommandIntentExtraction = {
					commands: [
						{
							commandType: clusterName,
							content: userInput,
						},
					],
					explanation: `Classified as ${clusterName} command based on semantic similarity.`,
					confidence: 0.8,
					lang: 'en',
				};

				return result;
			}
		}

		// Proceed with LLM-based intent extraction
		logger.log('Using LLM for intent extraction');
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			prompt: [
				userLanguagePrompt,
				commandIntentPrompt,
				...additionalPrompts,
				{ role: 'user', content: userInput },
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		const validatedResult = validateCommandIntentExtraction(parsed);

		// Save the embeddings
		if (validatedResult.confidence >= 0.9 && validatedResult.queryTemplate) {
			try {
				const newClusterName = [
					...new Set(validatedResult.commands.map(cmd => cmd.commandType)),
				].reduce((acc, curVal) => {
					return acc ? `${acc}:${curVal}` : curVal;
				}, '');
				await intentClassifier.saveEmbedding(validatedResult.queryTemplate, newClusterName);
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

	if (!Array.isArray(data.commands) || data.commands.length === 0) {
		logger.warn('Commands is an empty array');
	}

	const validCommandTypes = [
		'search',
		'move',
		'copy',
		'move_from_search_result',
		'delete_from_search_result',
		'calc',
		'close',
		'confirm',
		'revert',
		'image',
		'audio',
		'update_from_search_result',
	];

	// Validate each command in the sequence
	const validatedCommands = data.commands.map((cmd: any, index: number) => {
		if (!cmd || typeof cmd !== 'object') {
			throw new Error(`Invalid command format at index ${index}`);
		}

		if (!validCommandTypes.includes(cmd.commandType)) {
			throw new Error(
				`Command type at index ${index} (${cmd.commandType}) must be one of: ${validCommandTypes.join(', ')}`
			);
		}

		if (typeof cmd.content !== 'string' || !cmd.content.trim()) {
			logger.warn(`Content is empty at index ${index}`);
		}

		return {
			commandType: cmd.commandType,
			content: cmd.content.trim(),
		};
	});

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	// Lang is optional, but if provided, must be a valid string
	const lang =
		data.lang && typeof data.lang === 'string' && data.lang.trim() ? data.lang.trim() : 'en';

	// QueryTemplate is optional, but if provided, must be a valid string
	const queryTemplate =
		data.queryTemplate && typeof data.queryTemplate === 'string' && data.queryTemplate.trim()
			? data.queryTemplate.trim()
			: undefined;

	return {
		commands: validatedCommands,
		explanation: data.explanation.trim(),
		confidence: data.confidence,
		lang,
		queryTemplate,
	};
}
