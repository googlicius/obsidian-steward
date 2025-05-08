import { generateText } from 'modelfusion';
import { updateFromSearchResultPrompt } from './prompts/updateFromSearchResultPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { createLLMGenerator } from './llmConfig';

export interface ReplaceInstruction {
	type: 'replace';
	old: string;
	new: string;
}

export interface AddInstruction {
	type: 'add';
	content: string;
	position: 'beginning' | 'end' | number;
}

export type UpdateInstruction = ReplaceInstruction | AddInstruction;

export interface UpdateFromSearchResultExtraction {
	updateInstructions: UpdateInstruction[];
	explanation: string;
	confidence: number;
	lang?: string;
}

/**
 * Extracts update instructions from a search result update command
 */
export async function extractUpdateFromSearchResult({
	userInput,
	llmConfig,
	lang,
}: {
	userInput: string;
	llmConfig: StewardPluginSettings['llm'];
	lang?: string;
}): Promise<UpdateFromSearchResultExtraction> {
	const response = await generateText({
		model: createLLMGenerator(llmConfig),
		prompt: [
			userLanguagePrompt,
			updateFromSearchResultPrompt,
			confidenceScorePrompt,
			{ role: 'user', content: userInput },
		],
	});
	const result = JSON.parse(response);
	return validateUpdateFromSearchResultExtraction(result);
}

/**
 * Validate that the update from search results extraction contains all required fields
 */
function validateUpdateFromSearchResultExtraction(data: any): UpdateFromSearchResultExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (!Array.isArray(data.updateInstructions)) {
		throw new Error('Update instructions must be an array');
	}

	// Validate each instruction
	data.updateInstructions.forEach((instruction: any, index: number) => {
		if (!instruction.type || !['replace', 'add'].includes(instruction.type)) {
			throw new Error(`Instruction ${index}: Invalid type. Must be 'replace' or 'add'`);
		}

		if (instruction.type === 'replace') {
			if (typeof instruction.old !== 'string') {
				throw new Error(`Instruction ${index}: 'old' must be a string`);
			}
			if (typeof instruction.new !== 'string') {
				throw new Error(`Instruction ${index}: 'new' must be a string`);
			}
		} else if (instruction.type === 'add') {
			if (typeof instruction.content !== 'string') {
				throw new Error(`Instruction ${index}: 'content' must be a string`);
			}
			if (typeof instruction.position !== 'string' && typeof instruction.position !== 'number') {
				throw new Error(`Instruction ${index}: 'position' must be a string or number`);
			}
			if (
				typeof instruction.position === 'string' &&
				!['beginning', 'end'].includes(instruction.position)
			) {
				throw new Error(`Instruction ${index}: 'position' must be 'beginning', 'end', or a number`);
			}
		}
	});

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	return {
		updateInstructions: data.updateInstructions,
		explanation: data.explanation.trim(),
		confidence: data.confidence,
		lang: data.lang,
	};
}
