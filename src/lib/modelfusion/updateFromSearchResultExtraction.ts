import { generateText, openai } from 'modelfusion';
import { updateFromSearchResultPrompt } from './prompts/updateFromSearchResultPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';

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
export async function extractUpdateFromSearchResult(
	commandContent: string
): Promise<UpdateFromSearchResultExtraction> {
	const response = await generateText({
		model: openai.ChatTextGenerator({
			model: 'gpt-4-turbo-preview',
			temperature: 0.2,
			responseFormat: { type: 'json_object' },
		}),
		prompt: [
			userLanguagePrompt,
			updateFromSearchResultPrompt,
			confidenceScorePrompt,
			{ role: 'user', content: commandContent },
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
