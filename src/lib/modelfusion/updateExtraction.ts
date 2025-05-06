import { generateText } from 'modelfusion';
import { updateCommandPrompt } from './prompts/updateCommandPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { createLLMGenerator } from './llmConfig';

/**
 * Extracts the sequence of commands needed for an update operation
 */
export async function extractUpdateCommand({
	userInput,
	llmConfig,
	lang,
}: {
	userInput: string;
	llmConfig: StewardPluginSettings['llm'];
	lang?: string;
}): Promise<{
	commands: Array<{
		type: 'search' | 'update_from_search_result';
		content: string;
	}>;
	explanation: string;
	lang?: string;
}> {
	const response = await generateText({
		model: createLLMGenerator(llmConfig),
		prompt: [
			userLanguagePrompt,
			updateCommandPrompt,
			confidenceScorePrompt,
			{ role: 'user', content: userInput },
		],
	});
	const result = JSON.parse(response);
	return {
		commands: result.commands,
		explanation: result.explanation,
		lang: result.lang,
	};
}
