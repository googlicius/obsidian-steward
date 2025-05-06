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
	updateInstruction: UpdateInstruction;
	explanation: string;
	confidence: number;
	lang?: string;
}

/**
 * Extracts update instruction from a search result update command
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
	return {
		updateInstruction: result.updateInstruction,
		explanation: result.explanation,
		confidence: result.confidence,
		lang: result.lang,
	};
}
