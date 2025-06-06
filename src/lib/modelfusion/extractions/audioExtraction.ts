import { generateText } from 'modelfusion';
import { audioCommandPrompt } from '../prompts/audioCommandPrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { createLLMGenerator } from '../llmConfig';
import { validateConfidence, validateLanguage } from '../validators';
import { AbortService } from 'src/services/AbortService';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { getObsidianLanguage } from 'src/utils/getObsidianLanguage';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted audio generation details
 */
export interface AudioExtraction {
	text: string;
	model?: string;
	voice?: string;
	explanation: string;
	confidence?: number;
	lang?: string;
}

/**
 * Extract audio generation details from a user query
 * @param params Parameters for audio extraction
 * @returns Extracted audio generation details
 */
export async function extractAudioQuery(params: {
	userInput: string;
	systemPrompts?: string[];
	llmConfig: StewardPluginSettings['llm'];
}): Promise<AudioExtraction> {
	const { userInput, systemPrompts = [], llmConfig } = params;

	try {
		// Check if input is wrapped in quotation marks for direct extraction
		const quotedRegex = /^["'](.+)["']$/;
		const match = userInput.trim().match(quotedRegex);

		if (match) {
			const content = match[1];

			return {
				text: content,
				explanation: `Generating audio with: "${content}"`,
				lang: getObsidianLanguage(),
				confidence: 1,
			};
		}

		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('audio') },
			prompt: [
				userLanguagePrompt,
				audioCommandPrompt,
				...systemPrompts.map(prompt => ({ role: 'system', content: prompt })),
				{
					role: 'user',
					content: userInput,
				},
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateAudioExtraction(parsed);
	} catch (error) {
		console.error('Error extracting audio generation parameters:', error);
		throw error;
	}
}

/**
 * Validate that the audio extraction contains all required fields
 */
function validateAudioExtraction(data: any): AudioExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (typeof data.text !== 'string' || !data.text.trim()) {
		throw new Error('Text must be a non-empty string');
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	// Optional fields
	const model = data.model && typeof data.model === 'string' ? data.model.trim() : undefined;
	const voice = data.voice && typeof data.voice === 'string' ? data.voice.trim() : undefined;
	const confidence =
		data.confidence !== undefined ? validateConfidence(data.confidence) : undefined;
	const lang = data.lang ? validateLanguage(data.lang) : undefined;

	return {
		text: data.text.trim(),
		model,
		voice,
		explanation: data.explanation.trim(),
		confidence,
		lang,
	};
}
