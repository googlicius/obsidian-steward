import { generateText, openai } from 'modelfusion';
import { updateCommandPrompt } from './prompts/updateCommandPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';

/**
 * Extracts the sequence of commands needed for an update operation
 */
export async function extractUpdateCommand(commandContent: string): Promise<{
	commands: Array<{
		type: 'search' | 'update_from_search_result';
		content: string;
	}>;
	explanation: string;
	lang?: string;
}> {
	const response = await generateText({
		model: openai.ChatTextGenerator({
			model: 'gpt-4-turbo-preview',
			temperature: 0.2,
			responseFormat: { type: 'json_object' },
		}),
		prompt: [
			userLanguagePrompt,
			updateCommandPrompt,
			confidenceScorePrompt,
			{ role: 'user', content: commandContent },
		],
	});
	const result = JSON.parse(response);
	return {
		commands: result.commands,
		explanation: result.explanation,
		lang: result.lang,
	};
}
